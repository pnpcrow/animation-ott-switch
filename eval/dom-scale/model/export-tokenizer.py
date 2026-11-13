"""Serialize the exact fast tokenizer for browser parity checks; no model training."""
from pathlib import Path
from shared import tokenizer, verify_base, digest, write

if __name__=='__main__':
    verify_base()
    directory=Path('.tmp/dom-scale/model/tokenizer')
    tokenizer().save_pretrained(directory)
    files={path.name:{'path':str(path).replace('\\','/'),'bytes':path.stat().st_size,'sha256':digest(path)} for path in directory.iterdir() if path.is_file()}
    write('eval/dom-scale/model/tokenizer-manifest.json',{'schemaVersion':1,'sourceSha256':digest(__file__),'files':files})
    print({name:row['bytes'] for name,row in files.items()})
