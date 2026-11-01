/* ClaimEase - mail_scripts
 * name: ClaimEase Claim Record Link
 * field: script
 */

/**
 * ClaimEase Claim Record Link  (mail script)
 *
 * Prints the APPROVER-facing platform record link, for use as the `href` of a
 * button in an approver or support notification body:
 *     <a href="${mail_script:ClaimEase Claim Record Link}">Open the claim</a>
 *
 * Approvers and ClaimEase administrators work in the platform UI (where the
 * Approvals related list lives), so they get the record link rather than the
 * employee portal link. The instance URL comes from `glide.servlet.uri`, so it
 * is correct in every environment.
 */
;(function runMailScript(
    /* GlideRecord */ current,
    /* TemplatePrinter */ template,
    /* Optional EmailOutbound */ email,
    /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */ event
) {
    var base = '' + (gs.getProperty('glide.servlet.uri') || '')
    while (base.length && base.charAt(base.length - 1) === '/') {
        base = base.substring(0, base.length - 1)
    }
    template.print(base + '/' + current.getTableName() + '.do?sys_id=' + current.getUniqueValue())
})(current, template, email, email_action, event)
