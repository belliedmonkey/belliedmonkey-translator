# Read the pinned ASCEND test parquet. Selection stays in the node script.
import hashlib
import json
import sys


def load():
    try:
        import pyarrow.parquet as pq
    except ImportError:
        sys.stderr.write('extractor-missing\n')
        return 2
    return pq


def meta(parquet, dest):
    pq = load()
    if pq == 2:
        return 2
    table = pq.read_table(parquet, columns=[
        'id', 'transcription', 'duration', 'language', 'session_id', 'topic', 'original_speaker_id',
    ])
    rows = []
    for row in table.to_pylist():
        rows.append({
            'id': row['id'],
            'transcription': row['transcription'],
            'duration': row['duration'],
            'language': row['language'],
            'sessionId': row['session_id'],
            'topic': row['topic'],
            'originalSpeakerId': row['original_speaker_id'],
        })
    with open(dest, 'w', encoding='utf8') as handle:
        json.dump(rows, handle)
    return 0


def audio(parquet, id_list, dest):
    pq = load()
    if pq == 2:
        return 2
    wanted = set(id_list.split(','))
    table = pq.read_table(parquet, columns=['id', 'audio'])
    found = []
    for row in table.to_pylist():
        if row['id'] not in wanted:
            continue
        blob = row['audio']['bytes']
        if blob[:4] != b'RIFF' or blob[8:12] != b'WAVE':
            sys.stderr.write('not-wav\n')
            return 2
        name = row['id'] + '.wav'
        path = dest + '/' + name
        with open(path, 'wb') as handle:
            handle.write(blob)
        found.append({
            'id': row['id'],
            'audioName': name,
            'bytes': len(blob),
            'sha256': hashlib.sha256(blob).hexdigest(),
            'sourceAudioPath': row['audio']['path'],
        })
    sys.stdout.write(json.dumps(found))
    return 0 if len(found) == len(wanted) else 2


def main():
    mode = sys.argv[1]
    if mode == 'meta':
        return meta(sys.argv[2], sys.argv[3])
    if mode == 'audio':
        return audio(sys.argv[2], sys.argv[3], sys.argv[4])
    sys.stderr.write('extractor\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())
