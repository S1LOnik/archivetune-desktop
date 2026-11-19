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
  private static final class StreamEntry {
    final PlayableContentFeeder.LoadedStream loaded;
    final int audioOffset;
    final String trackUri;
    final long openedAt;
    StreamEntry(PlayableContentFeeder.LoadedStream loaded, int audioOffset, String trackUri) {
      this.loaded = loaded;
      this.audioOffset = audioOffset;
      this.trackUri = trackUri;
      this.openedAt = System.nanoTime();
    }
  }

  private Session session;
  private String account = "";
  private final HttpServer server;
  private final String capability = UUID.randomUUID().toString();
  private final Map<String, StreamEntry> streams = Collections.synchronizedMap(new LinkedHashMap<>());
  ArchiveTuneSpotify() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/" + capability + "/", this::serve);
    server.setExecutor(Executors.newFixedThreadPool(4));
    server.start();
  }
  private void serve(HttpExchange x) throws IOException {
    String id = x.getRequestURI().getPath().replace("/" + capability + "/", "");
    var entry = streams.get(id);
    if (entry == null || !(x.getRequestMethod().equals("GET") || x.getRequestMethod().equals("HEAD"))) { x.sendResponseHeaders(404,-1); x.close(); return; }
    var stream = entry.loaded.in.stream();
    final int audioOffset = entry.audioOffset;
    long size = stream.size() - audioOffset;
    if (size <= 0) { x.sendResponseHeaders(500, -1); x.close(); return; }
    long start = 0, end = size - 1;
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
          stream.seek((int)(position + audioOffset));
          read=stream.read(buffer,0,(int)Math.min(buffer.length,end-position+1));
        }
        if(read<0)break;
        out.write(buffer,0,read); position+=read;
      }
    } catch(Exception ignored) { /* Receiver disconnected or skipped the track. */ }
    finally { x.close(); }
  }
  private void ensureSession(JsonObject request) throws Exception {
    String user=request.has("user")?request.get("user").getAsString():"";
    if(session==null || !session.isValid() || !account.equals(user)) {
      if (session != null) session.close();
      synchronized (streams) {
        for (var entry : streams.values()) entry.loaded.in.stream().close();
        streams.clear();
      }
      var conf=new Session.Configuration.Builder().setStoreCredentials(false).setCacheEnabled(false).setConnectionTimeout(8).build();
      var credentials=Authentication.LoginCredentials.newBuilder()
        .setTyp(Authentication.AuthenticationType.AUTHENTICATION_SPOTIFY_TOKEN)
        .setAuthData(ByteString.copyFromUtf8(request.get("token").getAsString()));
      if(!user.isEmpty())credentials.setUsername(user);
      session=new Session.Builder(conf).setDeviceName("ArchiveTune Desktop").setDeviceType(Connect.DeviceType.COMPUTER).credentials(credentials.build()).create();
      account=user;
    }
    session.tokens().setDesktopAccessToken(request.get("token").getAsString());
  }

  private JsonObject streamResponse(String id) {
    JsonObject result = new JsonObject();
    result.addProperty("ok", true);
    result.addProperty("url", "http://127.0.0.1:" + server.getAddress().getPort() + "/" + capability + "/" + id);
    result.addProperty("qualityLabel", "Spotify native Vorbis");
    return result;
  }

  private JsonObject resolve(JsonObject request) throws Exception {
    if (request.has("warmup") && request.get("warmup").getAsBoolean()) {
      ensureSession(request);
      JsonObject result = new JsonObject();
      result.addProperty("ok", true);
      return result;
    }
    String uri = request.get("uri").getAsString();
    if (!uri.matches("spotify:track:[A-Za-z0-9]{22}")) throw new IllegalArgumentException();
    ensureSession(request);
    if (!request.has("reload") || !request.get("reload").getAsBoolean()) {
      synchronized (streams) {
        for (var entry : streams.entrySet()) {
          var cached = entry.getValue();
          if (cached.trackUri.equals(uri) && System.nanoTime() - cached.openedAt < 300_000_000_000L) {
            return streamResponse(entry.getKey());
          }
        }
      }
    }
    boolean premium="premium".equals(session.getUserAttribute("type", ""));
    var loaded=session.contentFeeder().load(PlayableId.fromUri(uri),new VorbisOnlyAudioQuality(premium?AudioQuality.VERY_HIGH:AudioQuality.HIGH),false,null);
    var stream = loaded.in.stream();
    int audioOffset = 167;
    synchronized(stream) {
      byte[] probe = new byte[512];
      stream.seek(0);
      int read = 0;
      while (read < probe.length) {
        int count = stream.read(probe, read, probe.length - read);
        if (count <= 0) break;
        read += count;
      }
      // A Vorbis identification packet starts at the page body, after the Ogg lacing table.
      for (int i = 0; i <= read - 35; i++) {
        if (probe[i] != 'O' || probe[i + 1] != 'g' || probe[i + 2] != 'g' ||
            probe[i + 3] != 'S' || probe[i + 4] != 0 || probe[i + 5] != 2) continue;
        int segments = Byte.toUnsignedInt(probe[i + 26]);
        int body = i + 27 + segments;
        if (segments == 0 || body + 7 > read || Byte.toUnsignedInt(probe[i + 27]) < 7) continue;
        if (probe[body] == 1 && probe[body + 1] == 'v' && probe[body + 2] == 'o' &&
            probe[body + 3] == 'r' && probe[body + 4] == 'b' &&
            probe[body + 5] == 'i' && probe[body + 6] == 's') {
          audioOffset = i;
          break;
        }
      }
    }
    String id=UUID.randomUUID().toString();
    synchronized(streams) {
      streams.put(id, new StreamEntry(loaded, audioOffset, uri));
      if(streams.size()>8) { String old=streams.keySet().iterator().next(); streams.remove(old).loaded.in.stream().close(); }
    }
    return streamResponse(id);
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
