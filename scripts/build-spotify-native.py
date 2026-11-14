"""Build the desktop Spotify bridge from pinned, hash-checked dependencies."""
from pathlib import Path
import hashlib, json, os, subprocess, urllib.request
root = Path(__file__).resolve().parent.parent
libs = root / 'assets/spotify-native'
libs.mkdir(parents=True, exist_ok=True)
for dependency in json.loads((root / 'native/spotify/dependencies.json').read_text()):
    target = libs / dependency['file']
    if not target.exists():
        temporary = target.with_suffix('.download')
        urllib.request.urlretrieve(dependency['url'], temporary)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != dependency['sha256']:
            temporary.unlink()
            raise SystemExit('Dependency checksum mismatch: ' + target.name)
        temporary.replace(target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != dependency['sha256']:
        raise SystemExit('Dependency checksum mismatch: ' + target.name)
classes = root / 'native/spotify/build'
classes.mkdir(parents=True, exist_ok=True)
sources = [str(p) for p in (root / 'native/spotify/src').rglob('*.java')]
subprocess.run(['javac', '--release', '17', '-cp', str(libs / '*'), '-d', str(classes), *sources], check=True)
subprocess.run(['jar', '--create', '--file', str(libs / 'archivetune-spotify.jar'), '-C', str(classes), '.'], check=True)
print('Native Spotify bridge built; dependency checksums verified')
