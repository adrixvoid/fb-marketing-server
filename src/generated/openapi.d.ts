export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Check process health */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/scopes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List authorized client and Ad Account pairs
         * @description Unscoped discovery exception. Returns only resolved pairs authorized for the
         *     authenticated caller. A cursor is bound to caller, filters, and request hash;
         *     reuse with a different binding returns 400.
         */
        get: operations["listScopes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/integration-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get safe integration diagnostics
         * @description Unscoped discovery exception. Optional client_id and ad_account_id must be
         *     supplied together; when absent, returns safe integration-level diagnostics.
         *     Diagnosed Meta configuration, reauthorization, asset-access, and permission
         *     states are successful 200 responses. Only local caller authorization uses 403.
         *     Any validation Meta call and normalized outcome are audited.
         */
        get: operations["getIntegrationStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Discover safe capabilities for one client and Ad Account
         * @description Returns static supported campaign kinds plus currently accessible dynamic
         *     Meta assets and actionable capability gaps for the resolved scope. Dynamic
         *     IDs are opaque and are revalidated at proposal creation and execution.
         *     Assets are deterministically paginated; cursors bind the authenticated caller,
         *     client/account scope, and a hash of the optional asset-type filter.
         *     This endpoint performs no mutation, proposal creation, approval, or execution.
         *     Diagnosed Meta configuration and asset-access gaps return 200; 403 is only
         *     for local caller authorization failure. Any Meta validation call and its
         *     normalized outcome are audited with the request correlation ID.
         */
        get: operations["getCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/campaigns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List campaigns for an Ad Account
         * @description Resolves the exact pair before the audited Meta v26.0 read.
         */
        get: operations["listCampaigns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/insights/query": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Query Ad Account insights
         * @description Every metric is available with a typed value or unavailable with a reason;
         *     absence is never a fabricated zero. A valid query with no data returns a 200
         *     page with an empty data array. 422 is only for a semantically unsupported
         *     query or metric. Cursor binding includes caller, scope, filters, and request hash.
         */
        post: operations["queryInsights"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget-pacing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get monthly budget pacing for one Ad Account
         * @description Returns one independently scoped pacing result. The account's Meta timezone
         *     defines month boundaries. If timezone is unavailable, reporting_month and all
         *     derived fields are unavailable as one correlated variant. At exact month start,
         *     elapsed_fraction and expected_spend_to_date are zero; only projection is unavailable.
         */
        get: operations["getBudgetPacing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stage a trusted OpenClaw chat attachment
         * @description Accepts multipart binary only, never a local path or URL. The service verifies
         *     actual content type and limits, hashes bytes, and stages privately. Media is
         *     scope-bound and removed no later than 12 hours after staging or when its linked
         *     operation completes or expires, whichever is earlier.
         */
        post: operations["stageMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an immutable mutation proposal
         * @description Creates a typed pending operation; it does not execute it. Meta validate-only
         *     preflight is used where applicable before persistent creation and is audited,
         *     but never replaces owner approval. expires_at is exactly created_at + 12 hours.
         *     Idempotency-Key binds authenticated caller, operation type, client/account, and
         *     canonical payload hash. Same key and payload returns the existing operation;
         *     different payload returns 409 idempotency_conflict. The key remains reserved
         *     with immutable operation and audit history; there is no short replay window.
         */
        post: operations["createOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/operations/{operation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get operation status */
        get: operations["getOperation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/operations/{operation_id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve and execute an operation
         * @description OWNER-COMMAND ONLY through deterministic `/approve-ad`, outside model dispatch.
         *     Approval is accepted only while now < expires_at; equality is expired. Before
         *     at-most-once execution, scope, budget, Meta authority, integration generation,
         *     and bound media hashes are revalidated. Decision and execution are audited.
         */
        post: operations["approveOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/operations/{operation_id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reject an operation
         * @description OWNER-COMMAND ONLY through deterministic `/reject-ad`, outside model dispatch.
         *     Rejection is separate from approval, valid only while now < expires_at,
         *     idempotent, immutable, audited, and permanently prevents execution.
         */
        post: operations["rejectOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Identifier: string;
        RequestId: string;
        /** @description Base-10 decimal string, never binary floating point. */
        Decimal: string;
        /** @description Ratio, rate, or fraction rounded to 6 decimal places using round-half-even. */
        Ratio: string;
        Currency: string;
        /** @description Amount rounded to the ISO 4217 currency minor unit using round-half-even. */
        Money: {
            amount: components["schemas"]["Decimal"];
            currency: components["schemas"]["Currency"];
        };
        PositiveMoney: {
            amount: string;
            currency: components["schemas"]["Currency"];
        };
        Health: {
            /** @constant */
            status: "ok";
            /** Format: date-time */
            time: string;
        };
        ResolvedScope: {
            client_id: components["schemas"]["Identifier"];
            client_name: string;
            ad_account_id: components["schemas"]["Identifier"];
            ad_account_name: string;
            currency?: components["schemas"]["Currency"];
            /** @description IANA timezone reported by Meta when available. */
            timezone?: string;
        };
        PageInfo: {
            next_cursor: string | null;
        };
        ScopePage: {
            request_id: components["schemas"]["RequestId"];
            data: components["schemas"]["ResolvedScope"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @enum {string} */
        IntegrationState: "registered" | "validating" | "active" | "configuration_required" | "reauthorization_required" | "asset_access_required";
        Diagnostic: {
            code: string;
            message: string;
            remediation: string;
        };
        /** @description Safe Meta permission name, including newly observed permissions; never a token, secret, credential, or authorization value. */
        MetaPermission: string;
        IntegrationStatus: {
            integration_id: components["schemas"]["Identifier"];
            generation: components["schemas"]["Identifier"];
            state: components["schemas"]["IntegrationState"];
            /** Format: date-time */
            checked_at: string;
            missing_permissions: components["schemas"]["MetaPermission"][];
            diagnostics: components["schemas"]["Diagnostic"][];
        };
        IntegrationStatusResponse: {
            request_id: components["schemas"]["RequestId"];
            scope?: components["schemas"]["ResolvedScope"];
            integration: components["schemas"]["IntegrationStatus"];
        };
        /** @enum {string} */
        CampaignKind: "SALES_WEBSITE" | "LEADS_WEBSITE" | "LEADS_INSTANT_FORM";
        /** @enum {string} */
        CapabilityAvailability: "available" | "unavailable";
        CapabilityCheck: {
            status: components["schemas"]["CapabilityAvailability"];
            /**
             * @description When status is unavailable, each code MUST match exactly one `gaps[].code`;
             *     available capabilities use an empty array. Gap codes are unique within a response.
             */
            diagnostic_codes: string[];
        };
        CapabilityMatrix: {
            reads: components["schemas"]["CapabilityCheck"];
            sales_website: components["schemas"]["CapabilityCheck"];
            leads_website: components["schemas"]["CapabilityCheck"];
            leads_instant_form: components["schemas"]["CapabilityCheck"];
            media_upload: components["schemas"]["CapabilityCheck"];
            proposal_creation: components["schemas"]["CapabilityCheck"];
        };
        CapabilityAccount: {
            /** @description Null only when unavailable and accompanied by gap code account_currency_unavailable; never fabricated. */
            currency: components["schemas"]["Currency"] | null;
            /** @description Meta-configured IANA timezone, or null with gap code account_timezone_unavailable; never fabricated. */
            timezone: string | null;
        };
        /** @enum {string} */
        CapabilityAssetType: "page" | "pixel" | "web_dataset" | "lead_form" | "instagram_account";
        PageAsset: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            asset_type: "page";
            page_id: components["schemas"]["Identifier"];
            name: string;
        };
        PixelAsset: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            asset_type: "pixel";
            pixel_id: components["schemas"]["Identifier"];
            name: string;
        };
        /** @description Meta web datasets use pixel_id semantics in this API. */
        WebDatasetAsset: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            asset_type: "web_dataset";
            pixel_id: components["schemas"]["Identifier"];
            name: string;
        };
        LeadFormAsset: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            asset_type: "lead_form";
            lead_gen_form_id: components["schemas"]["Identifier"];
            page_id: components["schemas"]["Identifier"];
            name: string;
            /** @constant */
            published: true;
            /** @constant */
            usable: true;
        };
        InstagramAccountAsset: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            asset_type: "instagram_account";
            instagram_account_id: components["schemas"]["Identifier"];
            name: string;
            page_id?: components["schemas"]["Identifier"];
        };
        CapabilityAsset: components["schemas"]["PageAsset"] | components["schemas"]["PixelAsset"] | components["schemas"]["WebDatasetAsset"] | components["schemas"]["LeadFormAsset"] | components["schemas"]["InstagramAccountAsset"];
        CapabilitiesResponse: {
            request_id: components["schemas"]["RequestId"];
            scope: components["schemas"]["ResolvedScope"];
            integration: components["schemas"]["IntegrationStatus"];
            account: components["schemas"]["CapabilityAccount"];
            /** @description Exactly SALES_WEBSITE, LEADS_WEBSITE, and LEADS_INSTANT_FORM. */
            supported_campaign_kinds: components["schemas"]["CampaignKind"][];
            /**
             * @description One deterministic page of accessible assets only. Order is stable by
             *     asset_type then opaque asset ID. IDs confer no authority.
             */
            assets: components["schemas"]["CapabilityAsset"][];
            page: components["schemas"]["PageInfo"];
            capabilities: components["schemas"]["CapabilityMatrix"];
            /**
             * @description Actionable reasons and remediation only; codes are unique and never contain
             *     tokens, secrets, or authorization material. Every unavailable capability
             *     diagnostic code matches exactly one entry here. Null currency and timezone
             *     require account_currency_unavailable and account_timezone_unavailable respectively.
             */
            gaps: components["schemas"]["Diagnostic"][];
        } & (unknown & unknown);
        /** @enum {string} */
        DeliveryStatus: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
        Campaign: {
            campaign_id: components["schemas"]["Identifier"];
            name: string;
            status: components["schemas"]["DeliveryStatus"];
            /** @enum {string} */
            objective: "OUTCOME_SALES" | "OUTCOME_LEADS";
            daily_budget?: components["schemas"]["Money"] | null;
            lifetime_budget?: components["schemas"]["Money"] | null;
        };
        CampaignPage: {
            request_id: components["schemas"]["RequestId"];
            scope: components["schemas"]["ResolvedScope"];
            data: components["schemas"]["Campaign"][];
            page: components["schemas"]["PageInfo"];
        };
        DateRange: {
            /** Format: date */
            since: string;
            /** Format: date */
            until: string;
        };
        InsightsQuery: {
            client_id: components["schemas"]["Identifier"];
            ad_account_id: components["schemas"]["Identifier"];
            date_range: components["schemas"]["DateRange"];
            /** @enum {string} */
            level: "account" | "campaign" | "ad_set" | "ad";
        };
        MetricUnavailable: {
            /** @constant */
            available: false;
            /** @enum {string} */
            reason: "action_type_not_applicable" | "attribution_not_available" | "permission_missing" | "value_not_reported" | "value_data_missing" | "zero_denominator";
            detail: string;
        };
        DecimalMetric: {
            /** @constant */
            available: true;
            value: components["schemas"]["Ratio"];
        } | components["schemas"]["MetricUnavailable"];
        IntegerMetric: {
            /** @constant */
            available: true;
            value: number;
        } | components["schemas"]["MetricUnavailable"];
        MoneyMetric: {
            /** @constant */
            available: true;
            value: components["schemas"]["Money"];
        } | components["schemas"]["MetricUnavailable"];
        InsightMetrics: {
            spend: components["schemas"]["MoneyMetric"];
            impressions: components["schemas"]["IntegerMetric"];
            reach: components["schemas"]["IntegerMetric"];
            clicks: components["schemas"]["IntegerMetric"];
            ctr: components["schemas"]["DecimalMetric"];
            cpc: components["schemas"]["MoneyMetric"];
            cpm: components["schemas"]["MoneyMetric"];
            results: components["schemas"]["DecimalMetric"];
            conversions: components["schemas"]["DecimalMetric"];
            cost_per_result: components["schemas"]["MoneyMetric"];
            roas: components["schemas"]["DecimalMetric"];
        };
        InsightRow: {
            entity_id: components["schemas"]["Identifier"];
            entity_name: string;
            date_range: components["schemas"]["DateRange"];
            metrics: components["schemas"]["InsightMetrics"];
        };
        InsightsResponse: {
            request_id: components["schemas"]["RequestId"];
            scope: components["schemas"]["ResolvedScope"];
            /** @enum {string} */
            level: "account" | "campaign" | "ad_set" | "ad";
            date_range: components["schemas"]["DateRange"];
            data: components["schemas"]["InsightRow"][];
            page: components["schemas"]["PageInfo"];
        };
        PacingUnavailable: {
            /** @constant */
            available: false;
            /** @enum {string} */
            reason: "budget_not_configured" | "spend_unavailable";
            detail: string;
        };
        PacingMoneyAvailable: {
            /** @constant */
            available: true;
            value: components["schemas"]["Money"];
        };
        PacingMoney: components["schemas"]["PacingMoneyAvailable"] | components["schemas"]["PacingUnavailable"];
        PacingProjection: components["schemas"]["PacingMoneyAvailable"] | {
            /** @constant */
            available: false;
            /** @enum {string} */
            reason: "month_just_started" | "spend_unavailable";
            detail: string;
        };
        BudgetPacingAvailable: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            availability: "available";
            scope: components["schemas"]["ResolvedScope"];
            /** @description Meta-configured IANA timezone. */
            timezone: string;
            currency: components["schemas"]["Currency"];
            reporting_month: string;
            /** Format: date-time */
            as_of: string;
            /** @constant */
            pacing_policy: "linear_elapsed_time";
            monthly_budget: components["schemas"]["PacingMoney"];
            mtd_spend: components["schemas"]["PacingMoney"];
            remaining: components["schemas"]["PacingMoney"];
            elapsed_fraction: components["schemas"]["Ratio"];
            expected_spend_to_date: components["schemas"]["PacingMoneyAvailable"];
            variance: components["schemas"]["PacingMoney"];
            projected_month_end_spend: components["schemas"]["PacingProjection"];
        };
        TimezoneUnavailableValue: {
            /** @constant */
            available: false;
            /** @constant */
            reason: "timezone_unavailable";
            detail: string;
        };
        /** @description Timezone-dependent values are explicitly unavailable; currency and monthly budget remain available independently. */
        BudgetPacingTimezoneUnavailable: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            availability: "unavailable";
            scope: components["schemas"]["ResolvedScope"];
            currency: components["schemas"]["Currency"];
            reporting_month: components["schemas"]["TimezoneUnavailableValue"];
            /** Format: date-time */
            as_of: string;
            /** @constant */
            pacing_policy: "linear_elapsed_time";
            monthly_budget: components["schemas"]["PacingMoneyAvailable"];
            mtd_spend: components["schemas"]["TimezoneUnavailableValue"];
            remaining: components["schemas"]["TimezoneUnavailableValue"];
            elapsed_fraction: components["schemas"]["TimezoneUnavailableValue"];
            expected_spend_to_date: components["schemas"]["TimezoneUnavailableValue"];
            variance: components["schemas"]["TimezoneUnavailableValue"];
            projected_month_end_spend: components["schemas"]["TimezoneUnavailableValue"];
            /** @constant */
            reason: "timezone_unavailable";
            detail: string;
        };
        BudgetPacingResponse: {
            request_id: components["schemas"]["RequestId"];
            pacing: components["schemas"]["BudgetPacingAvailable"] | components["schemas"]["BudgetPacingTimezoneUnavailable"];
        };
        AttachmentMetadata: {
            /** @constant */
            source: "openclaw_chat_attachment";
            attachment_id: components["schemas"]["Identifier"];
            /** @description Basename display metadata only; slash, backslash, and control characters are rejected. Never interpreted as a path. */
            original_filename: string;
            /** @enum {string} */
            declared_content_type: "image/jpeg" | "image/png" | "video/mp4";
            alt_text?: string;
        };
        MediaUpload: {
            client_id: components["schemas"]["Identifier"];
            ad_account_id: components["schemas"]["Identifier"];
            /** Format: binary */
            file: string;
            attachment: components["schemas"]["AttachmentMetadata"];
        };
        StagedMedia: {
            media_id: components["schemas"]["Identifier"];
            sha256: string;
            /** @enum {string} */
            status: "staged" | "bound" | "consumed" | "expired" | "invalid";
            /** @enum {string} */
            media_type: "image" | "video";
            /** @enum {string} */
            content_type: "image/jpeg" | "image/png" | "video/mp4";
            size_bytes: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            expires_at: string;
            operation_id?: components["schemas"]["Identifier"] | null;
        };
        MediaResponse: {
            request_id: components["schemas"]["RequestId"];
            scope: components["schemas"]["ResolvedScope"];
            media: components["schemas"]["StagedMedia"];
        };
        CreateOperationRequest: components["schemas"]["CreateCampaignOperationRequest"] | components["schemas"]["UpdateObjectOperationRequest"] | components["schemas"]["ChangeDeliveryOperationRequest"] | components["schemas"]["ConfigureMonthlyBudgetOperationRequest"];
        CreateCampaignOperationRequest: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "create_campaign_bundle";
            client_id: components["schemas"]["Identifier"];
            ad_account_id: components["schemas"]["Identifier"];
            payload: components["schemas"]["CampaignBundleProposal"];
        };
        UpdateObjectOperationRequest: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "update_object";
            client_id: components["schemas"]["Identifier"];
            ad_account_id: components["schemas"]["Identifier"];
            payload: components["schemas"]["UpdateObjectPayload"];
        };
        ChangeDeliveryOperationRequest: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "change_delivery";
            client_id: components["schemas"]["Identifier"];
            ad_account_id: components["schemas"]["Identifier"];
            payload: components["schemas"]["ChangeDeliveryPayload"];
        };
        ConfigureMonthlyBudgetOperationRequest: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "configure_monthly_budget";
            client_id: components["schemas"]["Identifier"];
            ad_account_id: components["schemas"]["Identifier"];
            payload: components["schemas"]["MonthlyBudgetPayload"];
        };
        /**
         * @description Fixed internal mappings: SALES_WEBSITE = OUTCOME_SALES + WEBSITE +
         *     OFFSITE_CONVERSIONS + IMPRESSIONS + pixel_id + PURCHASE + website URL;
         *     LEADS_WEBSITE = OUTCOME_LEADS + WEBSITE + OFFSITE_CONVERSIONS + IMPRESSIONS
         *     + pixel_id + LEAD + website URL; LEADS_INSTANT_FORM = OUTCOME_LEADS + ON_AD
         *     + LEAD_GENERATION + IMPRESSIONS + page_id + published lead_gen_form_id.
         *     Form and page must match. Callers cannot supply those derived Meta values.
         */
        CampaignBundleProposal: {
            /** @description Selects the fixed objective, destination, optimization goal, billing event, conversion event, and required assets. */
            campaign_kind: components["schemas"]["CampaignKind"];
            campaign: components["schemas"]["CampaignProposal"];
            ad_set: components["schemas"]["AdSetProposal"];
            creative: components["schemas"]["CreativeProposal"];
            ad: components["schemas"]["AdProposal"];
        };
        CampaignProposal: {
            name: string;
            budget: components["schemas"]["DailyBudget"] | components["schemas"]["LifetimeBudget"];
        };
        DailyBudget: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "daily";
            value: components["schemas"]["PositiveMoney"];
        };
        LifetimeBudget: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "lifetime";
            value: components["schemas"]["PositiveMoney"];
        };
        /** @description Runtime validation requires pixel_id for website variants or a published matching lead_gen_form_id for instant forms. */
        AdSetProposal: {
            name: string;
            pixel_id?: components["schemas"]["Identifier"];
            lead_gen_form_id?: components["schemas"]["Identifier"];
            /** Format: date-time */
            start_time?: string;
            /** Format: date-time */
            end_time?: string;
            targeting: components["schemas"]["Targeting"];
        };
        Targeting: {
            countries: string[];
            minimum_age: number;
            maximum_age: number;
        };
        CreativeProposal: {
            name: string;
            page_id: components["schemas"]["Identifier"];
            instagram_account_id?: components["schemas"]["Identifier"];
            message: string;
            headline?: string;
            /** Format: uri */
            website_url?: string;
            /**
             * @description Union allowlist; runtime validation enforces Sales or Leads variant-specific subset.
             * @enum {string}
             */
            call_to_action: "SHOP_NOW" | "BUY_NOW" | "ORDER_NOW" | "ADD_TO_CART" | "LEARN_MORE" | "GET_OFFER" | "SUBSCRIBE" | "SIGN_UP" | "APPLY_NOW" | "GET_QUOTE" | "CONTACT_US" | "BOOK_NOW" | "GET_STARTED";
            media: components["schemas"]["MediaBinding"][];
        };
        MediaBinding: {
            media_id: components["schemas"]["Identifier"];
            sha256: string;
        };
        AdProposal: {
            name: string;
        };
        UpdateObjectPayload: components["schemas"]["UpdateCampaignPayload"] | components["schemas"]["UpdateAdSetPayload"] | components["schemas"]["UpdateAdPayload"];
        UpdateCampaignPayload: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            object_type: "campaign";
            object_id: components["schemas"]["Identifier"];
            changes: components["schemas"]["CampaignChanges"];
        };
        CampaignChanges: {
            name?: string;
            budget?: components["schemas"]["DailyBudget"] | components["schemas"]["LifetimeBudget"];
        };
        UpdateAdSetPayload: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            object_type: "ad_set";
            object_id: components["schemas"]["Identifier"];
            changes: components["schemas"]["AdSetChanges"];
        };
        AdSetChanges: {
            name?: string;
            /** Format: date-time */
            start_time?: string;
            /** Format: date-time */
            end_time?: string;
            targeting?: components["schemas"]["Targeting"];
        };
        UpdateAdPayload: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            object_type: "ad";
            object_id: components["schemas"]["Identifier"];
            changes: components["schemas"]["AdChanges"];
        };
        AdChanges: {
            name?: string;
        };
        ChangeDeliveryPayload: {
            /** @enum {string} */
            action: "ACTIVATE" | "PAUSE" | "RESUME";
            /** @enum {string} */
            object_type: "Campaign" | "AdSet" | "Ad";
            object_id: components["schemas"]["Identifier"];
        };
        MonthlyBudgetPayload: {
            monthly_budget: components["schemas"]["PositiveMoney"];
        };
        /** @enum {string} */
        OperationStatus: "pending" | "executing" | "succeeded" | "rejected" | "expired" | "stale" | "failed";
        OperationBase: {
            operation_id: components["schemas"]["Identifier"];
            type: string;
            status: components["schemas"]["OperationStatus"];
            scope: components["schemas"]["ResolvedScope"];
            integration_generation: components["schemas"]["Identifier"];
            payload_hash: string;
            payload: unknown;
            /** Format: date-time */
            created_at: string;
            /**
             * Format: date-time
             * @description Exactly created_at + 12 hours; valid only while now is earlier.
             */
            expires_at: string;
            decision?: components["schemas"]["OperationDecision"] | null;
            result?: null | Record<string, never>;
        };
        TypedOperation: components["schemas"]["CreateCampaignOperation"] | components["schemas"]["UpdateObjectOperation"] | components["schemas"]["ChangeDeliveryOperation"] | components["schemas"]["ConfigureMonthlyBudgetOperation"];
        CreateCampaignOperation: components["schemas"]["OperationBase"] & {
            /** @constant */
            type?: "create_campaign_bundle";
            payload?: components["schemas"]["CampaignBundleProposal"];
            result?: components["schemas"]["CreateCampaignResult"] | components["schemas"]["MutationFailed"] | null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "create_campaign_bundle";
        };
        UpdateObjectOperation: components["schemas"]["OperationBase"] & {
            /** @constant */
            type?: "update_object";
            payload?: components["schemas"]["UpdateObjectPayload"];
            result?: components["schemas"]["MutationResult"] | null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "update_object";
        };
        ChangeDeliveryOperation: components["schemas"]["OperationBase"] & {
            /** @constant */
            type?: "change_delivery";
            payload?: components["schemas"]["ChangeDeliveryPayload"];
            result?: components["schemas"]["MutationResult"] | null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "change_delivery";
        };
        ConfigureMonthlyBudgetOperation: components["schemas"]["OperationBase"] & {
            /** @constant */
            type?: "configure_monthly_budget";
            payload?: components["schemas"]["MonthlyBudgetPayload"];
            result?: components["schemas"]["MutationResult"] | null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "configure_monthly_budget";
        };
        Operation: components["schemas"]["PendingOperation"] | components["schemas"]["ExecutingOperation"] | components["schemas"]["SucceededOperation"] | components["schemas"]["RejectedOperation"] | components["schemas"]["ExpiredOperation"] | components["schemas"]["StaleOperation"] | components["schemas"]["FailedOperation"];
        PendingOperation: Omit<components["schemas"]["TypedOperation"], "type"> & {
            /** @constant */
            status: "pending";
            result: null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "pending";
        };
        ExecutingOperation: Omit<components["schemas"]["TypedOperation"], "type"> & {
            /** @constant */
            status: "executing";
            result: null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "executing";
        };
        SucceededOperation: Omit<components["schemas"]["TypedOperation"], "type"> & {
            /** @constant */
            status: "succeeded";
            result: {
                /** @constant */
                status: "succeeded";
            };
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "succeeded";
        };
        RejectedOperation: Omit<components["schemas"]["TypedOperation"], "type"> & {
            /** @constant */
            status: "rejected";
            result: null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "rejected";
        };
        ExpiredOperation: Omit<components["schemas"]["TypedOperation"], "type"> & {
            /** @constant */
            status: "expired";
            result: null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "expired";
        };
        StaleOperation: Omit<components["schemas"]["TypedOperation"], "type"> & {
            /** @constant */
            status: "stale";
            result: null;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "stale";
        };
        FailedOperation: Omit<components["schemas"]["TypedOperation"], "type"> & {
            /** @constant */
            status: "failed";
            result: components["schemas"]["MutationFailed"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "failed";
        };
        OperationDecision: {
            /** @enum {string} */
            decision: "approved" | "rejected";
            /** Format: date-time */
            decided_at: string;
            owner_identity: string;
        };
        PausedCreatedObject: {
            object_id: components["schemas"]["Identifier"];
            /** @constant */
            delivery_status: "PAUSED";
        };
        BoundCreative: {
            object_id: components["schemas"]["Identifier"];
            /** @constant */
            bound: true;
        };
        /** @description Exactly one Campaign, Ad Set, Creative, and Ad; only the three delivery objects are PAUSED. */
        CreateCampaignResult: {
            /** @constant */
            status: "succeeded";
            /** Format: date-time */
            completed_at: string;
            campaign: components["schemas"]["PausedCreatedObject"];
            ad_set: components["schemas"]["PausedCreatedObject"];
            creative: components["schemas"]["BoundCreative"];
            ad: components["schemas"]["PausedCreatedObject"];
        };
        MutationResult: components["schemas"]["MutationSucceeded"] | components["schemas"]["MutationFailed"];
        MutationSucceeded: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "MutationSucceeded";
            /** Format: date-time */
            completed_at: string;
        };
        MutationFailed: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            status: "MutationFailed";
            /** Format: date-time */
            completed_at: string;
            /** @enum {string} */
            failure_code: "operation_stale" | "meta_configuration_required" | "meta_reauthorization_required" | "meta_asset_access_required" | "meta_permission_missing" | "media_invalid" | "rate_limited" | "meta_error";
        };
        OperationResponse: {
            request_id: components["schemas"]["RequestId"];
            operation: components["schemas"]["Operation"];
        };
        PendingOperationResponse: components["schemas"]["OperationResponse"] & {
            operation?: Omit<components["schemas"]["Operation"], "status"> & {
                /** @constant */
                status?: "pending";
            };
        };
        AcceptedOperationResponse: components["schemas"]["OperationResponse"] & {
            operation?: Omit<components["schemas"]["Operation"], "status"> & {
                /** @enum {string} */
                status?: "pending" | "executing";
            };
        };
        CompletedOperationResponse: components["schemas"]["OperationResponse"] & {
            operation?: Omit<components["schemas"]["Operation"], "status"> & {
                /** @enum {string} */
                status: "succeeded" | "failed";
                result: Record<string, never>;
            };
        };
        RejectedOperationResponse: components["schemas"]["OperationResponse"] & {
            operation?: Omit<components["schemas"]["Operation"], "status"> & {
                /** @constant */
                status?: "rejected";
            };
        };
        /** @description Preserves whichever known scope identifiers were supplied; omitted when no scope input was provided. */
        SuppliedScope: {
            client_id?: components["schemas"]["Identifier"];
            ad_account_id?: components["schemas"]["Identifier"];
        };
        /** @description Exact supplied query strings; values are not normalized or replaced and omitted fields are not invented. */
        CapabilitySuppliedScope: {
            client_id?: string;
            ad_account_id?: string;
        };
        /** @description Both exact required query strings for client_account_mismatch. */
        CapabilityRequiredSuppliedScope: {
            client_id: string;
            ad_account_id: string;
        };
        FieldError: {
            field: string;
            reason: string;
        };
        ProblemBase: {
            /** Format: uri */
            type: string;
            title: string;
            status: number;
            code: string;
            detail: string;
            /** Format: uri-reference */
            instance?: string;
            request_id: components["schemas"]["RequestId"];
            supplied_scope?: components["schemas"]["SuppliedScope"];
            resolved_scope?: components["schemas"]["ResolvedScope"];
            operation_id?: components["schemas"]["Identifier"];
            errors?: components["schemas"]["FieldError"][];
        };
        /** @description Capability error shape deliberately excludes resolved_scope and resolved labels. */
        CapabilityProblemBase: {
            /** Format: uri */
            type: string;
            title: string;
            status: number;
            code: string;
            detail: string;
            /** Format: uri-reference */
            instance?: string;
            request_id: components["schemas"]["RequestId"];
            supplied_scope?: components["schemas"]["CapabilitySuppliedScope"];
            errors?: components["schemas"]["FieldError"][];
        };
        CapabilityProblem400: components["schemas"]["CapabilityProblemBase"] & {
            /** @constant */
            status?: 400;
            /** @enum {string} */
            code?: "validation_error" | "cursor_mismatch";
        };
        CapabilityProblem401: components["schemas"]["CapabilityProblemBase"] & {
            /** @constant */
            status?: 401;
            /** @constant */
            code?: "unauthorized";
        };
        CapabilityProblem403: components["schemas"]["CapabilityProblemBase"] & {
            /** @constant */
            status?: 403;
            /** @constant */
            code?: "forbidden";
        };
        CapabilityProblem409: components["schemas"]["CapabilityProblemBase"] & {
            /** @constant */
            status?: 409;
            /** @constant */
            code?: "client_account_mismatch";
            supplied_scope: components["schemas"]["CapabilityRequiredSuppliedScope"];
        };
        Problem400: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 400;
            /** @enum {string} */
            code?: "validation_error" | "cursor_mismatch";
        };
        Problem401: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 401;
            /** @constant */
            code?: "unauthorized";
        };
        Problem403: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 403;
            /** @constant */
            code?: "forbidden";
        };
        Problem404: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 404;
            /** @constant */
            code?: "not_found";
        };
        Problem409Scope: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 409;
            /** @constant */
            code?: "client_account_mismatch";
        };
        Problem409CreateOperation: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 409;
            /** @enum {string} */
            code?: "client_account_mismatch" | "idempotency_conflict";
        };
        Problem409OperationLifecycle: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 409;
            /** @enum {string} */
            code?: "client_account_mismatch" | "operation_stale" | "operation_already_resolved";
        };
        Problem410: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 410;
            /** @constant */
            code?: "operation_expired";
        };
        Problem413: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 413;
            /** @constant */
            code?: "media_too_large";
        };
        Problem422Query: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 422;
            /** @constant */
            code?: "unsupported_query";
        };
        Problem422Media: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 422;
            /** @constant */
            code?: "media_invalid";
        };
        Problem422Operation: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 422;
            /** @enum {string} */
            code?: "unsupported_campaign_variant" | "unsupported_campaign_combination" | "meta_preflight_rejected" | "asset_incompatible" | "operation_semantics_invalid";
        };
        Problem429: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 429;
            /** @constant */
            code?: "rate_limited";
        };
        Problem500: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 500;
            /** @constant */
            code?: "internal_error";
        };
        Problem502: components["schemas"]["ProblemBase"] & {
            /** @constant */
            status?: 502;
            /** @constant */
            code?: "meta_error";
        };
    };
    responses: {
        /**
         * @description Invalid capability query or cursor binding. `resolved_scope` is forbidden.
         *     Each supplied query ID is copied to `supplied_scope` exactly as received,
         *     without normalization, substitution, or resolved labels; omitted IDs are not invented.
         */
        CapabilityBadRequest: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["CapabilityProblem400"];
            };
        };
        /**
         * @description Service bearer is missing or invalid. `resolved_scope` is forbidden. Any
         *     supplied query IDs are preserved exactly without disclosing resolved labels.
         */
        CapabilityUnauthorized: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                "WWW-Authenticate"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["CapabilityProblem401"];
            };
        };
        /**
         * @description Authenticated local caller lacks authority. `resolved_scope` is forbidden. Any
         *     supplied query IDs are preserved exactly without disclosing resolved labels.
         */
        CapabilityForbidden: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["CapabilityProblem403"];
            };
        };
        /**
         * @description Supplied client and Ad Account do not resolve to the same authorized scope.
         *     `resolved_scope` is forbidden and `supplied_scope` preserves both required
         *     query values exactly, without normalization, substitution, or resolved labels.
         */
        CapabilityScopeConflict: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["CapabilityProblem409"];
            };
        };
        /** @description Invalid input, scope pair, or cursor binding. */
        BadRequest: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem400"];
            };
        };
        /** @description Service bearer is missing or invalid. */
        Unauthorized: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                "WWW-Authenticate"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem401"];
            };
        };
        /** @description Authenticated local caller lacks authority. */
        Forbidden: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem403"];
            };
        };
        /** @description Supplied resource was not found or visible in its scope. */
        NotFound: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem404"];
            };
        };
        /** @description Supplied client and Ad Account do not resolve to the same authorized scope. */
        ScopeConflict: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem409Scope"];
            };
        };
        /** @description Scope mismatch or idempotency key reuse with a different canonical payload. */
        CreateOperationConflict: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem409CreateOperation"];
            };
        };
        /** @description Scope mismatch or operation state prevents the requested lifecycle transition. */
        OperationLifecycleConflict: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem409OperationLifecycle"];
            };
        };
        /** @description Operation expired because now is equal to or later than expires_at. */
        Gone: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem410"];
            };
        };
        /** @description Attachment exceeds an applicable limit. */
        PayloadTooLarge: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem413"];
            };
        };
        /** @description Query or requested metric is semantically unsupported. */
        UnsupportedQuery: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem422Query"];
            };
        };
        /** @description Media is unsupported, mismatched, expired, wrong-scope, or hash-invalid. */
        UnprocessableMedia: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem422Media"];
            };
        };
        /** @description Operation payload, campaign combination, preflight, or bound assets are semantically invalid. */
        UnprocessableOperation: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem422Operation"];
            };
        };
        /** @description Local or Meta request rate exceeded. */
        RateLimited: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                /** @description Nonnegative delay in whole seconds serialized as an HTTP header string. */
                "Retry-After"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem429"];
            };
        };
        /** @description Normalized Meta upstream failure; raw bodies and secrets are excluded. */
        UpstreamError: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem502"];
            };
        };
        /** @description A normalized internal service failure with no secret or implementation detail. */
        InternalError: {
            headers: {
                "X-Request-ID": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem500"];
            };
        };
    };
    parameters: {
        RequestId: components["schemas"]["RequestId"];
        ClientIdQuery: components["schemas"]["Identifier"];
        AdAccountIdQuery: components["schemas"]["Identifier"];
        OptionalClientIdQuery: components["schemas"]["Identifier"];
        OptionalAdAccountIdQuery: components["schemas"]["Identifier"];
        /**
         * @description Opaque cursor bound to authenticated caller, resolved scope when applicable,
         *     filters, and request hash. Mismatched reuse returns 400.
         */
        Cursor: string;
        Limit: number;
        /** @description Optional asset discriminator. Its exact value is included in the cursor filter hash. */
        CapabilityAssetType: components["schemas"]["CapabilityAssetType"];
        /** @description Permanently reserved opaque proposal identity key. */
        IdempotencyKey: string;
        OperationId: components["schemas"]["Identifier"];
        /** @description Short-lived proof unavailable to model dispatch and never logged or returned. */
        OwnerCommandProof: string;
    };
    requestBodies: never;
    headers: {
        RequestId: components["schemas"]["RequestId"];
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Process is available; no integration details are inspected or returned. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            500: components["responses"]["InternalError"];
        };
    };
    listScopes: {
        parameters: {
            query?: {
                /**
                 * @description Opaque cursor bound to authenticated caller, resolved scope when applicable,
                 *     filters, and request hash. Mismatched reuse returns 400.
                 */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized resolved scope page. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScopePage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            500: components["responses"]["InternalError"];
        };
    };
    getIntegrationStatus: {
        parameters: {
            query?: {
                client_id?: components["parameters"]["OptionalClientIdQuery"];
                ad_account_id?: components["parameters"]["OptionalAdAccountIdQuery"];
            };
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Safe integration status, optionally resolved to one scope. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationStatusResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["ScopeConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            502: components["responses"]["UpstreamError"];
        };
    };
    getCapabilities: {
        parameters: {
            query: {
                client_id: components["parameters"]["ClientIdQuery"];
                ad_account_id: components["parameters"]["AdAccountIdQuery"];
                /**
                 * @description Opaque cursor bound to authenticated caller, resolved scope when applicable,
                 *     filters, and request hash. Mismatched reuse returns 400.
                 */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                /** @description Optional asset discriminator. Its exact value is included in the cursor filter hash. */
                asset_type?: components["parameters"]["CapabilityAssetType"];
            };
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Safe discovery metadata and capability status for the resolved scope. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilitiesResponse"];
                };
            };
            400: components["responses"]["CapabilityBadRequest"];
            401: components["responses"]["CapabilityUnauthorized"];
            403: components["responses"]["CapabilityForbidden"];
            409: components["responses"]["CapabilityScopeConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            502: components["responses"]["UpstreamError"];
        };
    };
    listCampaigns: {
        parameters: {
            query: {
                client_id: components["parameters"]["ClientIdQuery"];
                ad_account_id: components["parameters"]["AdAccountIdQuery"];
                status?: components["schemas"]["DeliveryStatus"];
                /**
                 * @description Opaque cursor bound to authenticated caller, resolved scope when applicable,
                 *     filters, and request hash. Mismatched reuse returns 400.
                 */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Campaign page for the resolved Ad Account. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["ScopeConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            502: components["responses"]["UpstreamError"];
        };
    };
    queryInsights: {
        parameters: {
            query?: {
                /**
                 * @description Opaque cursor bound to authenticated caller, resolved scope when applicable,
                 *     filters, and request hash. Mismatched reuse returns 400.
                 */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InsightsQuery"];
            };
        };
        responses: {
            /** @description Insights page, including an empty page for valid no-data queries. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InsightsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["ScopeConflict"];
            422: components["responses"]["UnsupportedQuery"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            502: components["responses"]["UpstreamError"];
        };
    };
    getBudgetPacing: {
        parameters: {
            query: {
                client_id: components["parameters"]["ClientIdQuery"];
                ad_account_id: components["parameters"]["AdAccountIdQuery"];
                /** @description Reporting instant; defaults to the server's current instant. */
                as_of?: string;
            };
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Correlated available or timezone-unavailable pacing result. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BudgetPacingResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["ScopeConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            502: components["responses"]["UpstreamError"];
        };
    };
    stageMedia: {
        parameters: {
            query?: never;
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["MediaUpload"];
            };
        };
        responses: {
            /** @description Attachment validated and staged. */
            201: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["ScopeConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["UnprocessableMedia"];
            500: components["responses"]["InternalError"];
        };
    };
    createOperation: {
        parameters: {
            query?: never;
            header: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
                /** @description Permanently reserved opaque proposal identity key. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOperationRequest"];
            };
        };
        responses: {
            /** @description Same idempotency key and canonical payload; existing operation returned. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationResponse"];
                };
            };
            /** @description Immutable pending proposal created. */
            201: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PendingOperationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["CreateOperationConflict"];
            422: components["responses"]["UnprocessableOperation"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            502: components["responses"]["UpstreamError"];
        };
    };
    getOperation: {
        parameters: {
            query: {
                client_id: components["parameters"]["ClientIdQuery"];
                ad_account_id: components["parameters"]["AdAccountIdQuery"];
            };
            header?: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
            };
            path: {
                operation_id: components["parameters"]["OperationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current immutable proposal and separately recorded lifecycle state. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["ScopeConflict"];
            500: components["responses"]["InternalError"];
        };
    };
    approveOperation: {
        parameters: {
            query: {
                client_id: components["parameters"]["ClientIdQuery"];
                ad_account_id: components["parameters"]["AdAccountIdQuery"];
            };
            header: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
                /** @description Short-lived proof unavailable to model dispatch and never logged or returned. */
                "X-OpenClaw-Owner-Command": components["parameters"]["OwnerCommandProof"];
            };
            path: {
                operation_id: components["parameters"]["OperationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Execution completed, or the completed idempotent result is returned. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompletedOperationResponse"];
                };
            };
            /** @description Approval accepted; operation remains pending or is executing. */
            202: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AcceptedOperationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["OperationLifecycleConflict"];
            410: components["responses"]["Gone"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            502: components["responses"]["UpstreamError"];
        };
    };
    rejectOperation: {
        parameters: {
            query: {
                client_id: components["parameters"]["ClientIdQuery"];
                ad_account_id: components["parameters"]["AdAccountIdQuery"];
            };
            header: {
                "X-Request-ID"?: components["parameters"]["RequestId"];
                /** @description Short-lived proof unavailable to model dispatch and never logged or returned. */
                "X-OpenClaw-Owner-Command": components["parameters"]["OwnerCommandProof"];
            };
            path: {
                operation_id: components["parameters"]["OperationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Rejection recorded or identical rejection already recorded. */
            200: {
                headers: {
                    "X-Request-ID": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RejectedOperationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["OperationLifecycleConflict"];
            410: components["responses"]["Gone"];
            500: components["responses"]["InternalError"];
        };
    };
}
