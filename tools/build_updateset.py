"""Build a loadable ServiceNow remote update set XML from exported unload XML.

The payload of each sys_update_xml entry is the platform's own serialization of
the record, copied verbatim out of the exported unload XML, so no field value is
re-encoded or lost on the way through.
"""
import io, os, re, uuid, datetime

REPO = 'E:/Claude/claimease'
EXPORT = os.path.join(REPO, 'export')
NOW = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

# Commit order: structure before the things that reference it, flows last.
ORDER = ['sys_app', 'sys_db_object', 'sys_dictionary', 'sys_documentation', 'sys_choice_set',
         'question_choice', 'sys_number', 'sys_relationship', 'sys_user_role',
         'sys_user_role_contains', 'user_criteria', 'sys_security_acl', 'sys_security_acl_role',
         'sys_scope_privilege', 'sys_restricted_caller_access', 'sys_properties',
         'sys_script_include', 'sys_script', 'sys_script_email', 'sysevent_register',
         'sysevent_email_action', 'sys_notification_category', 'sys_ui_form', 'sys_ui_section',
         'sys_ui_list', 'sys_ui_related_list', 'sc_category', 'sc_cat_item_category',
         'sc_cat_item_catalog', 'sc_cat_item_producer', 'item_option_new',
         'catalog_script_client', 'catalog_ui_policy', 'catalog_ui_policy_action',
         'sc_cat_item_user_criteria_mtom', 'sp_widget', 'sp_page', 'sp_container', 'sp_row',
         'sp_column', 'sp_instance', 'sp_instance_menu', 'sp_rectangle_menu_item',
         'sp_page_route_map', 'sp_portal', 'm2m_sp_portal_catalog',
         'sys_hub_action_type_definition', 'sys_hub_action_type_snapshot', 'sys_hub_action_input',
         'sys_hub_action_output', 'sys_hub_flow', 'sys_hub_flow_input', 'sys_hub_flow_output',
         'sys_hub_flow_block', 'sys_hub_step_ext_input', 'sys_hub_step_ext_output',
         'sys_hub_flow_snapshot', 'sys_app_info', 'ua_table_licensing_config']

TYPE = {'sys_script': 'Business Rule', 'sys_script_include': 'Script Include',
        'sys_dictionary': 'Dictionary', 'sys_db_object': 'Table', 'sys_security_acl': 'ACL',
        'sysevent_email_action': 'Email Notification', 'sys_hub_flow': 'Flow',
        'sp_widget': 'Widget', 'sys_properties': 'System Property', 'sys_user_role': 'Role',
        'sc_cat_item_producer': 'Record Producer', 'sys_app': 'Application'}


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def records(xml, table):
    """Yield each top-level <table>...</table> block verbatim."""
    return re.findall(r'<%s>.*?</%s>' % (re.escape(table), re.escape(table)), xml, re.S)


def field(block, name):
    m = re.search(r'<%s>(.*?)</%s>' % (name, name), block, re.S)
    return m.group(1) if m else ''


def build(sources, name, description, out_path):
    rus = str(uuid.uuid4()).replace('-', '')
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<unload unload_date="%s">' % NOW,
             '<sys_remote_update_set action="INSERT_OR_UPDATE">',
             '<application display_value="Global">global</application>',
             '<application_name>Global</application_name>',
             '<application_scope>global</application_scope>',
             '<description>%s</description>' % esc(description),
             '<is_default>false</is_default>',
             '<name>%s</name>' % esc(name),
             '<release_date/>',
             '<remote_sys_id>%s</remote_sys_id>' % rus,
             '<state>loaded</state>',
             '<sys_class_name>sys_remote_update_set</sys_class_name>',
             '<sys_created_on>%s</sys_created_on>' % NOW,
             '<sys_id>%s</sys_id>' % rus,
             '<sys_mod_count>0</sys_mod_count>',
             '<sys_updated_on>%s</sys_updated_on>' % NOW,
             '<update_set/>', '<update_source/>',
             '</sys_remote_update_set>']
    total = 0
    for table, path in sources:
        if not os.path.exists(path):
            print('  skip (missing) %s' % table)
            continue
        xml = io.open(path, encoding='utf-8').read()
        for blk in records(xml, table):
            sys_id = field(blk, 'sys_id').strip()
            tgt = (field(blk, 'name') or field(blk, 'sys_name') or field(blk, 'label')
                   or field(blk, 'element') or sys_id)
            opened = '<%s action="INSERT_OR_UPDATE">' % table
            payload = '<record_update table="%s">%s</record_update>' % (
                table, blk.replace('<%s>' % table, opened, 1))
            parts += ['<sys_update_xml action="INSERT_OR_UPDATE">',
                      '<action>INSERT_OR_UPDATE</action>',
                      '<application display_value="Global">global</application>',
                      '<category>customer</category>',
                      '<comments/>',
                      '<name>%s_%s</name>' % (table, sys_id),
                      '<payload>%s</payload>' % esc(payload),
                      '<remote_update_set display_value="%s">%s</remote_update_set>' % (esc(name), rus),
                      '<replace_on_upgrade>false</replace_on_upgrade>',
                      '<sys_created_on>%s</sys_created_on>' % NOW,
                      '<sys_id>%s</sys_id>' % str(uuid.uuid4()).replace('-', ''),
                      '<sys_mod_count>0</sys_mod_count>',
                      '<sys_updated_on>%s</sys_updated_on>' % NOW,
                      '<table>%s</table>' % table,
                      '<target_name>%s</target_name>' % esc(tgt[:255]),
                      '<type>%s</type>' % esc(TYPE.get(table, table)),
                      '<update_domain>global</update_domain>',
                      '<update_guid>%s</update_guid>' % sys_id,
                      '</sys_update_xml>']
            total += 1
    parts.append('</unload>')
    xml_out = '\n'.join(parts)
    io.open(out_path, 'w', encoding='utf-8', newline='\n').write(xml_out)
    print('  %-44s %4d entries  %8.1f KB' % (os.path.basename(out_path), total, len(xml_out) / 1024.0))
    return total


print('Building update sets:')

build([('sys_script', os.path.join(EXPORT, 'global__sys_script.xml'))],
      'ClaimEase - global business rules (receipt enforcement)',
      'The two global-scope business rules that do not travel with the scoped application: '
      'ClaimEase - Enforce Receipt On Submitted, and ClaimEase - Restore Claim On Receipt.',
      os.path.join(REPO, 'update-sets', 'claimease-global-rules.xml'))

# sys_metadata_delete records development history - field ACLs that were created
# and later removed while the app was being built. They are DELETE instructions,
# so shipping them in an installer would make the target instance delete records
# rather than create them. Kept in export/ for provenance, left out of the set.
EXCLUDE = {'sys_metadata_delete'}

present = [t for t in ORDER if os.path.exists(os.path.join(EXPORT, t + '.xml'))
           and t not in EXCLUDE]
extra = sorted(f[:-4] for f in os.listdir(EXPORT)
               if f.endswith('.xml') and f[:-4] not in present
               and not f.startswith('global__') and f[:-4] != 'sys_app'
               and f[:-4] not in EXCLUDE)
if extra:
    print('  (appended, absent from the explicit order: %s)' % ', '.join(extra))
print('  (excluded by design: %s)' % ', '.join(sorted(EXCLUDE)))
srcs = [(t, os.path.join(EXPORT, t + '.xml')) for t in present + extra]

build(srcs, 'ClaimEase - full application v1.0.0',
      'Every exportable artifact of the ClaimEase scoped application (x_2180676_claime_0) '
      'taken from dev314379. Preview before committing; see INSTALL.md.',
      os.path.join(REPO, 'update-sets', 'claimease-full-app.xml'))
