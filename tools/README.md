# Export tooling

The scripts that produced `export/`, `src/`, `manifest.json` and `update-sets/`. Run them to
refresh this repository from a live instance.

## Credentials

None of these scripts contain credentials, and none should. `sn.py` reads a **curl config file**
named `sn.hdr`, placed in the working directory, holding a single header line:

```
header = "Authorization: Basic <base64 of user:password>"
```

Keeping the credential in a curl config rather than on a command line keeps it out of shell
history and out of process listings. `sn.hdr` is listed in `.gitignore` — do not commit it.

The account needs to read the instance and to fetch `<table>_list.do?XML`. A plain `admin` works.
A `web_service_access_only` account also works for everything here, which is how the original
export was made.

## Order

```bash
# 1. inventory: writes inventory.json, which the others read
python -c "import sn,json,io; rows=sn.table('sys_metadata','sys_scope=<SCOPE_SYS_ID>','sys_id,sys_class_name,sys_name,sys_update_name',limit=5000); io.open('inventory.json','w').write(json.dumps(rows,indent=1)); print(len(rows),'artifacts')"

python export_app.py        # per-table unload XML -> export/, plus manifest.json
python export_src.py        # readable source -> src/
python build_updateset.py   # -> update-sets/
```

Set `REPO` at the top of each script to wherever the repository lives, and the scope sys_id in
`export_app.py`. On Windows use a drive-qualified path (`E:/...`); a bare `/e/...` resolves against
the current drive and silently writes somewhere else.

## What the scripts do

**`export_app.py`** asks the platform for its own unload XML, one request per table
(`<table>_list.do?XML&sysparm_query=sys_scope=...`). It is the platform's serializer rather than a
field-by-field reconstruction, so nothing is re-encoded. It writes `manifest.json` comparing the
count `sys_metadata` expects against the count actually exported, per table — **check that file
after every run**, since a mismatch is how you find a table that silently refused.

**`export_src.py`** pulls script bodies over the Table API into `src/` as `.js`/`.html` with a
provenance header. Generated for review and diffing only; it is not used to install anything.

**`build_updateset.py`** turns the exported XML into loadable remote update sets. Each record block
is copied verbatim out of the unload XML into a `sys_update_xml` payload, wrapped in
`<record_update table="...">` with `action="INSERT_OR_UPDATE"`. `ORDER` controls commit sequence —
structure first, flows last. `EXCLUDE` drops `sys_metadata_delete`, which records development
history as DELETE instructions and has no place in an installer.

## Known export gaps

`sys_index` (5 records) refuses both XML export and REST reads. The unique index on
`x_2180676_claime_0_claim_lock.lock_key` therefore has to be recreated by hand, and it is
load-bearing — see step 4 of [INSTALL.md](../INSTALL.md). `export/sys_index.json` is an empty
placeholder recording that the attempt was made and refused, rather than that no indexes exist.
