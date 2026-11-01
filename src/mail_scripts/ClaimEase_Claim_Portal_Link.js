/* ClaimEase - mail_scripts
 * name: ClaimEase Claim Portal Link
 * field: script
 */

/**
 * ClaimEase Claim Portal Link  (mail script)
 *
 * Prints the EMPLOYEE-facing deep link to the ClaimEase claim detail page, for
 * use as the `href` of a button in a notification body:
 *     <a href="${mail_script:ClaimEase Claim Portal Link}">View your claim</a>
 *
 * The portal suffix comes from ClaimEaseConfig.getPortalSuffix() (property
 * `x_2180676_claime_0.portal_suffix`) and the instance URL from
 * `glide.servlet.uri`, so the link is correct in every environment and nothing
 * is hardcoded.
 */
;(function runMailScript(
    /* GlideRecord */ current,
    /* TemplatePrinter */ template,
    /* Optional EmailOutbound */ email,
    /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */ event
) {
    var suffix = new ClaimEaseConfig().getPortalSuffix()
    var base = '' + (gs.getProperty('glide.servlet.uri') || '')
    while (base.length && base.charAt(base.length - 1) === '/') {
        base = base.substring(0, base.length - 1)
    }
    template.print(
        base +
            '/' +
            suffix +
            '?id=x_2180676_claime_0_claimease_claim&sys_id=' +
            current.getUniqueValue()
    )
})(current, template, email, email_action, event)
