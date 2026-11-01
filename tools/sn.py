import json,urllib.request,urllib.parse,re,io,base64
BASE="https://dev314379.service-now.com"
_auth=None
def auth():
    global _auth
    if _auth is None:
        txt=io.open('sn.hdr',encoding='utf-8',errors='replace').read()
        m=re.search(r'Authorization:\s*([^"\'\r\n]+)',txt)
        if not m: raise SystemExit('no auth header found in sn.hdr')
        _auth=m.group(1).strip()
    return _auth
def api(method,path,body=None,params=None):
    url=BASE+path
    if params: url+=('&' if '?' in url else '?')+urllib.parse.urlencode(params)
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(url,data=data,method=method)
    r.add_header('Authorization',auth()); r.add_header('Accept','application/json')
    if data: r.add_header('Content-Type','application/json')
    try:
        with urllib.request.urlopen(r) as resp: return json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return {'__error__':e.code,'__body__':e.read().decode()[:400]}
def table(name,query,fields,limit=10000):
    return api('GET','/api/now/table/'+name,params={'sysparm_query':query,'sysparm_fields':fields,'sysparm_limit':limit}).get('result',[])
