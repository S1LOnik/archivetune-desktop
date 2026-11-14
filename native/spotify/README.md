# Desktop Spotify audio bridge

Build: `python3 scripts/build-spotify-native.py` (JDK 17+, Python 3). Runtime: Java 17+.

The bridge uses the stripped librespot-java 1.6.5 library and six Java overrides from S1LOnik/ArchiveTune commit a00f3319a54f6500295b375cdf7049314cfe4130. Original Apache-2.0 notices are retained in those source files; desktop changes remove Android diagnostic logging. Runtime jars retain their own license notices. Dependency URLs and SHA-256 checksums are in dependencies.json.

The adapter source is ArchiveTuneSpotify.java. Requests are JSON lines on stdin; credentials are never sent as process arguments or included in audio URLs. Responses carry a random, loopback-only audio URL with byte-range seeking. stderr is discarded by the application. Closing stdin or quitting the app terminates the child.

Integration only labels a stream Spotify after the native feeder has successfully prepared audio. Failed authentication/audio resolution falls back to the configured alternate sources. Authentication and real playback must be verified against the account; building successfully does not prove server-side availability.
