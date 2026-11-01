/* ClaimEase - portal_widgets
 * name: ClaimEase - My Claims
 * id: x_2180676_claime_0_my_claims
 * field: css
 */

/*
 * ClaimEase - "My Claims" widget styles
 * Theme SCSS variables only: no raw hex, no !important, no inline styles.
 */
.claimease-my-claims {
    .claimease-filters {
        border-bottom: 1px solid $panel-border-color;
        padding-bottom: 0;
    }

    .claimease-filter-actions {
        margin-bottom: 8px;

        .btn {
            margin-right: 8px;
        }
    }

    .claimease-table {
        margin-bottom: 0;

        th,
        td {
            vertical-align: middle;
        }

        tbody th {
            font-weight: normal;
        }
    }

    .claimease-summary {
        font-size: 90%;
    }

    .claimease-amount {
        white-space: nowrap;
    }

    .claimease-flags {
        font-size: 85%;
        margin-top: 4px;

        span {
            display: block;
        }
    }

    .claimease-progress {
        .claimease-step {
            display: block;
            margin-bottom: 4px;
            white-space: nowrap;
        }

        .claimease-step-label {
            color: $text-tertiary;
            display: inline-block;
            font-size: 85%;
            min-width: 60px;
        }
    }

    .claimease-count {
        display: inline-block;
        margin-left: 12px;
    }
}
