import com.google.gson.*;
import com.google.protobuf.ByteString;
import com.spotify.Authentication;
import com.spotify.connectstate.Connect;
import com.sun.net.httpserver.*;
import xyz.gianlu.librespot.core.Session;
import xyz.gianlu.librespot.metadata.PlayableId;
import xyz.gianlu.librespot.audio.AbsChunkedInputStream;
import xyz.gianlu.librespot.audio.PlayableContentFeeder;
import xyz.gianlu.librespot.audio.decoders.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;

/** Desktop adapter. Credentials arrive on stdin, never command-line arguments or HTTP URLs. */
public final class ArchiveTuneSpotify {
  private Session session;
  private String account = "";
  private final HttpServer server;
  private final String capability = UUID.randomUUID().toString();
  private final Map<String, PlayableContentFeeder.LoadedStream> streams = Collections.synchronizedMap(new LinkedHashMap<>());
  ArchiveTuneSpotify() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/" + capability + "/", this::serve);
    server.setExecutor(Executors.newFixedThreadPool(4));
    server.start();
  }
  private void serve(HttpExchange x) throws IOException {
    String id = x.getRequestURI().getPath().replace("/" + capability + "/", "");
    var loaded = streams.get(id);
    if (loaded == null || !(x.getRequestMethod().equals("GET") || x.getRequestMethod().equals("HEAD"))) { x.sendResponseHeaders(404,-1); x.close(); return; }
    var stream = loaded.in.stream();
    long size = stream.size(), start = 0, end = size-1;
    String range = x.getRequestHeaders().getFirst("Range");
    boolean partial = range != null;
    if (partial) {
      try {
        var match = java.util.regex.Pattern.compile("bytes=(\\d+)-(\\d*)").matcher(range);
        if (!match.matches()) throw new IllegalArgumentException();
        start = Long.parseLong(match.group(1));
        if (!match.group(2).isEmpty()) end = Math.min(end, Long.parseLong(match.group(2)));
        if (start < 0 || start >= size || end < start) throw new IllegalArgumentException();
      } catch (Exception error) { x.getResponseHeaders().set("Content-Range","bytes */"+size); x.sendResponseHeaders(416,-1); x.close(); return; }
      x.getResponseHeaders().set("Content-Range", "bytes " + start + "-" + end + "/" + size);
    }
    x.getResponseHeaders().set("Content-Type", "audio/ogg");
    x.getResponseHeaders().set("Accept-Ranges", "bytes");
    x.getResponseHeaders().set("Content-Length", Long.toString(end-start+1));
    if (x.getRequestMethod().equals("HEAD")) { x.sendResponseHeaders(partial?206:200,-1); x.close(); return; }
    x.sendResponseHeaders(partial?206:200,end-start+1);
    try (OutputStream out = x.getResponseBody()) {
      byte[] buffer = new byte[65536];
      for (long position=start;position<=end;) {
        int read;
        synchronized(stream) {
          stream.seek((int)position);
          read=stream.read(buffer,0,(int)Math.min(buffer.length,end-position+1));
        }
        if(read<0)break;
        out.write(buffer,0,read); position+=read;
      }
    } catch(Exception ignored) { /* Receiver disconnected or skipped the track. */ }
    finally { x.close(); }
  }
  private JsonObject resolve(JsonObject request) throws Exception {
    String uri=request.get("uri").getAsString();
    if(!uri.matches("spotify:track:[A-Za-z0-9]{22}"))throw new IllegalArgumentException();
    String user=request.has("user")?request.get("user").getAsString():"";
    if(session==null || !session.isValid() || !account.equals(user)) {
      if(session!=null)session.close();
      var conf=new Session.Configuration.Builder().setStoreCredentials(false).setCacheEnabled(false).setConnectionTimeout(8).build();
      var credentials=Authentication.LoginCredentials.newBuilder()
        .setTyp(Authentication.AuthenticationType.AUTHENTICATION_SPOTIFY_TOKEN)
        .setAuthData(ByteString.copyFromUtf8(request.get("token").getAsString()));
      if(!user.isEmpty())credentials.setUsername(user);
      session=new Session.Builder(conf).setDeviceName("ArchiveTune Desktop").setDeviceType(Connect.DeviceType.COMPUTER).credentials(credentials.build()).create();
      account=user;
    }
    session.tokens().setDesktopAccessToken(request.get("token").getAsString());
    boolean premium="premium".equals(session.getUserAttribute("type", ""));
    var loaded=session.contentFeeder().load(PlayableId.fromUri(uri),new VorbisOnlyAudioQuality(premium?AudioQuality.VERY_HIGH:AudioQuality.HIGH),false,null);
    String id=UUID.randomUUID().toString();
    synchronized(streams) {
      streams.put(id,loaded);
      if(streams.size()>8) { String old=streams.keySet().iterator().next(); streams.remove(old).in.stream().close(); }
    }
    JsonObject result=new JsonObject();result.addProperty("ok",true);
    result.addProperty("url","http://127.0.0.1:"+server.getAddress().getPort()+"/"+capability+"/"+id);
    result.addProperty("qualityLabel","Spotify native Vorbis");return result;
  }
  public static void main(String[] args) throws Exception {
    System.setProperty("org.slf4j.simpleLogger.defaultLogLevel","off");
    var bridge=new ArchiveTuneSpotify();
    Runtime.getRuntime().addShutdownHook(new Thread(()->{bridge.server.stop(0);if(bridge.session!=null)try{bridge.session.close();}catch(Exception ignored){}}));
    try(var reader=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8))) {
      String line;
      while((line=reader.readLine())!=null) {
        JsonObject request=null,result;
        try { request=JsonParser.parseString(line).getAsJsonObject();result=bridge.resolve(request); }
        catch(Throwable error) { result=new JsonObject();result.addProperty("ok",false);result.addProperty("error","Native Spotify session or audio unavailable");result.addProperty("code",error.getClass().getSimpleName()); String message=error.getMessage();if(message!=null && message.matches("[0-9]{3}:.*"))result.addProperty("httpStatus",Integer.parseInt(message.substring(0,3))); JsonArray frames=new JsonArray();for(int i=0;i<Math.min(4,error.getStackTrace().length);i++)frames.add(error.getStackTrace()[i].getClassName()+"."+error.getStackTrace()[i].getMethodName());result.add("frames",frames); }
        if(request!=null && request.has("requestId"))result.add("requestId",request.get("requestId"));
        System.out.println(result);System.out.flush();
      }
    }
    System.exit(0);
  }
}
