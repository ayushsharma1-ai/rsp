"""Introspect the FastAPI app + SQLAlchemy models and print a structured dump
(used to author the API + DB-model docs). Also writes learning/openapi.json.
Run:  ..\\venv\\Scripts\\python.exe gen_docs.py"""
import json
from app.main import app as fastapi_app   # 'as' avoids clashing with the `app` package
from app.core.database import Base
from app.modules import models  # noqa: F401  (register all tables/mappers)

app = fastapi_app
# authoritative machine spec
spec = app.openapi()
with open('../learning/openapi.json', 'w', encoding='utf-8') as f:
    json.dump(spec, f, indent=2, default=str)
print('wrote ../learning/openapi.json')

print('\n===== ROUTES =====')
rows = []
for r in app.routes:
    methods = getattr(r, 'methods', None)
    if not methods:
        continue
    ms = ','.join(sorted(m for m in methods if m not in ('HEAD', 'OPTIONS')))
    if not ms:
        continue
    rows.append((r.path, ms, r.name))
for path, ms, name in sorted(rows):
    print(f'{ms:14} {path}    [{name}]')

print('\n===== MODELS =====')
for t in Base.metadata.sorted_tables:
    print(f'\n#### {t.name}')
    for c in t.columns:
        fks = ','.join(sorted(fk.target_fullname for fk in c.foreign_keys))
        typ = str(c.type)
        enums = (' {' + '|'.join(c.type.enums) + '}') if hasattr(c.type, 'enums') else ''
        flags = []
        if c.primary_key: flags.append('PK')
        flags.append('NULL' if c.nullable else 'NOT NULL')
        if c.default is not None or c.server_default is not None: flags.append('default')
        if fks: flags.append('FK->' + fks)
        if c.unique: flags.append('unique')
        print(f'   {c.name}: {typ}{enums}  [{", ".join(flags)}]')
    idx = [ix.name + '(' + ','.join(col.name for col in ix.columns) + ')' for ix in t.indexes]
    if idx:
        print('   indexes: ' + ', '.join(idx))

print('\n===== RELATIONSHIPS =====')
for mapper in Base.registry.mappers:
    rels = list(mapper.relationships)
    if rels:
        print(f'{mapper.class_.__name__}:')
        for rel in rels:
            print(f'   {rel.key} -> {rel.mapper.class_.__name__} ({"many" if rel.uselist else "one"})')
