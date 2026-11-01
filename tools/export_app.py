"""Export every artifact of the ClaimEase scoped application as platform unload XML."""
import sn, json, io, os, re, collections, urllib.parse, urllib.request

SCOPE = 'b1cb0c6ac304d3100d60f8ddd4013149'
REPO  = 'E:/Claude/claimease'
OUT   = os.path.join(REPO, 'export')

def unload(table, query):
    """Fetch the platform's own unload XML for a filtered list."""
    url = ('https://dev314379.service-now.com/' + table + '_list.do?XML&sysparm_query='
           + urllib.parse.quote(query, safe=''))
    r = urllib.request.Request(url)
    r.add_header('Authorization', sn.auth())
    with urllib.request.urlopen(r) as resp:
        return resp.read().decode('utf-8', errors='replace')

def count_records(xml, table):
    return len(re.findall(r'<%s>' % re.escape(table), xml))

inv = json.load(io.open('inventory.json'))
tables = collections.Counter(r['sys_class_name'] for r in inv)
os.makedirs(OUT, exist_ok=True)

manifest = {'scope': 'x_2180676_claime_0', 'scope_sys_id': SCOPE, 'tables': {}, 'totals': {}}
total_expected = total_got = 0
for table, expected in sorted(tables.items()):
    try:
        xml = unload(table, 'sys_scope=' + SCOPE)
    except Exception as e:
        print('  FAIL %-34s %s' % (table, e)); manifest['tables'][table] = {'expected': expected, 'error': str(e)}; continue
    got = count_records(xml, table)
    io.open(os.path.join(OUT, table + '.xml'), 'w', encoding='utf-8', newline='\n').write(xml)
    manifest['tables'][table] = {'expected': expected, 'exported': got, 'bytes': len(xml)}
    total_expected += expected; total_got += got
    flag = '' if got == expected else '   <-- MISMATCH'
    print('  %-34s expected %4d  exported %4d%s' % (table, expected, got, flag))

manifest['totals'] = {'expected': total_expected, 'exported': total_got}
io.open(os.path.join(REPO, 'manifest.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps(manifest, indent=2))
print('\nTOTAL expected %d, exported %d' % (total_expected, total_got))
