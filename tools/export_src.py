"""Extract human-readable source for every scripted artifact in ClaimEase."""
import sn, io, os, re
SCOPE='b1cb0c6ac304d3100d60f8ddd4013149'
SRC='E:/Claude/claimease/src'

def slug(s):
    s=re.sub(r'[^A-Za-z0-9]+','_',(s or 'unnamed')).strip('_')
    return re.sub(r'_+','_',s)[:80] or 'unnamed'

def dump(folder, rows, name_field, script_fields, meta_fields):
    d=os.path.join(SRC,folder); os.makedirs(d,exist_ok=True)
    n=0
    for r in rows:
        base=slug(r.get(name_field))
        for sf in script_fields:
            body=r.get(sf)
            if not body or not str(body).strip(): continue
            suffix='' if len(script_fields)==1 else '.'+sf
            ext='.html' if sf in ('template','message_html','body') else '.js'
            head=['/* ClaimEase - %s'%folder, ' * %s: %s'%(name_field, r.get(name_field))]
            for mf in meta_fields:
                v=r.get(mf)
                if isinstance(v,dict): v=v.get('display_value') or v.get('value')
                if v not in (None,''): head.append(' * %s: %s'%(mf,v))
            head.append(' * field: %s'%sf); head.append(' */')
            txt=('\n'.join(head)+'\n\n'+str(body)).replace('\r\n','\n')
            io.open(os.path.join(d,base+suffix+ext),'w',encoding='utf-8',newline='\n').write(txt)
            n+=1
    print('  %-26s %d file(s)'%(folder,n))
    return n

total=0
total+=dump('script_includes',
    sn.table('sys_script_include','sys_scope='+SCOPE,'name,api_name,script,active,access'),
    'name',['script'],['api_name','active','access'])
total+=dump('business_rules_scoped',
    sn.table('sys_script','sys_scope='+SCOPE,'name,collection,when,order,active,script,filter_condition'),
    'name',['script'],['collection','when','order','active','filter_condition'])
total+=dump('business_rules_global',
    sn.table('sys_script','nameSTARTSWITHClaimEase ^sys_scope=global','name,collection,when,order,active,script,filter_condition'),
    'name',['script'],['collection','when','order','active','filter_condition'])
total+=dump('catalog_client_scripts',
    sn.table('catalog_script_client','sys_scope='+SCOPE,'name,type,script,active,applies_to'),
    'name',['script'],['type','active','applies_to'])
total+=dump('record_producer',
    sn.table('sc_cat_item_producer','sys_scope='+SCOPE,'name,table_name,script,mandatory_attachment'),
    'name',['script'],['table_name','mandatory_attachment'])
total+=dump('mail_scripts',
    sn.table('sys_script_email','sys_scope='+SCOPE,'name,script'),
    'name',['script'],[])
total+=dump('notifications',
    sn.table('sysevent_email_action','sys_scope='+SCOPE,'name,subject,message,message_html,event_name,table,active'),
    'name',['message','message_html'],['event_name','table','subject','active'])
total+=dump('portal_widgets',
    sn.table('sp_widget','sys_scope='+SCOPE,'name,id,script,client_script,template,css'),
    'name',['script','client_script','template','css'],['id'])
print('\nTOTAL source files: %d'%total)
