/* ClaimEase - portal_widgets
 * name: ClaimEase - Submit or track a claim
 * id: x_2180676_claime_0_claim_actions
 * field: script
 */

/**
 * ClaimEase - Landing widget server script
 *
 * Reads NO claim data. The only record it touches is the record producer
 * definition, so that the "Submit a claim" link does not have to hardcode a
 * sys_id. Every value handed to the client is a page id or a catalog item
 * sys_id — never anything about an employee or a claim.
 */
(function () {
    data.producerName = options.producer_name || 'Submit a Reimbursement Claim';
    data.catalogItemPageId = options.catalog_item_page || 'sc_cat_item';
    data.myClaimsPageId = options.my_claims_page || 'x_2180676_claime_0_claimease_my_claims';

    data.producerSysId = '';
    data.submitUrl = '';
    data.myClaimsUrl = '?id=' + data.myClaimsPageId;

    try {
        var producer = new GlideRecord('sc_cat_item_producer');
        producer.addQuery('name', data.producerName);
        producer.addQuery('active', true);
        producer.setLimit(1);
        producer.query();
        if (producer.next()) {
            data.producerSysId = producer.getUniqueValue() + '';
            data.submitUrl = '?id=' + data.catalogItemPageId + '&sys_id=' + data.producerSysId;
        } else {
            gs.error(
                '[ClaimEase] The portal landing widget could not find an active record producer named "' +
                    data.producerName +
                    '".'
            );
        }
    } catch (e) {
        gs.error('[ClaimEase] The portal landing widget could not read the record producer definition: ' + e);
    }
})();
