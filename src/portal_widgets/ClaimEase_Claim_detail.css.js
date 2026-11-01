/* ClaimEase - portal_widgets
 * name: ClaimEase - Claim detail
 * id: x_2180676_claime_0_claim_detail
 * field: css
 */

/*
 * ClaimEase - Claim detail widget styles
 * Theme SCSS variables only: no raw hex, no !important, no inline styles.
 */
.claimease-claim-detail {
    .claimease-detail-heading {
        align-items: center;
        display: flex;
        justify-content: space-between;

        .label {
            margin-left: 8px;
        }
    }

    .claimease-detail-summary {
        color: $text-secondary;
        font-size: 110%;
        margin-bottom: 16px;
    }

    .claimease-detail-list {
        margin-bottom: 0;

        dd {
            margin-bottom: 8px;
        }
    }

    .claimease-detail-text {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .claimease-progress {
        .claimease-step {
            margin-bottom: 12px;
        }

        .claimease-step-name {
            color: $text-tertiary;
            display: block;
            font-size: 90%;
            margin-bottom: 4px;
        }

        .claimease-step-hint {
            font-size: 85%;
            margin-top: 4px;
        }
    }

    .claimease-feedback {
        margin-bottom: 0;
        margin-top: 8px;
    }

    .claimease-file-meta {
        display: block;
        margin-top: 2px;
    }
}
