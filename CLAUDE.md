# Reporting Command Center — Claude Instructions

This is a standalone SaaS reporting dashboard for service businesses using GoHighLevel / HighLevel data.

## Product Direction
- App name: Reporting Command Center
- Standalone SaaS app, not inside Service Command Ops
- Premium hybrid light UI
- Dark navy sidebar
- Light gray-blue content background
- White cards
- Bright blue active states
- Deep navy text
- Mock/live GHL-ready reporting architecture

## Dashboard Views
Use these **reporting dashboard** views only:
- Overview Dashboard
- Opportunity Dashboard
- Sales Dashboard
- Owner Dashboard
- Marketing Dashboard

Do not create VA Dashboard.
Do not create VA_USER role.
Use User / Sales Rep instead of VA.

### Scope of this restriction
This restriction governs **reporting dashboards**. It means no additional reporting
dashboard may be introduced beyond the five listed above.

It does **not** prohibit the separately authorized **Task Management** module, which is a
non-reporting operational feature with its own top-level navigation entry. Task Management
is not a dashboard view and does not extend, replace, or alter the five reporting
dashboards above.

The prohibitions on a VA Dashboard and a VA_USER role remain in force and are unchanged.

## Security Rules
- Never expose GHL tokens client-side
- Never put tokens in NEXT_PUBLIC variables
- Never commit .env.local
- All GHL API calls must happen server-side
- Use mock data unless REPORTING_DATA_SOURCE=live
- Mock data must be clearly labeled

## UI Rules
- Match the existing screenshot-inspired layout
- Preserve the dark navy sidebar
- Preserve the light content area
- Preserve white cards and bright blue accents
- Do not convert the app to full dark mode
- Do not convert the app to plain white generic UI

## Development Rules
- Do not rewrite the entire app unless explicitly asked
- Fix errors with minimal file changes
- Preserve existing routes and components
- Run lint/typecheck/build after major changes when available
- No broken imports
- No hydration errors
- No hardcoded production credentials

## GHL Environment Variables
Required for live mode:
- REPORTING_DATA_SOURCE=live
- GHL_PRIVATE_INTEGRATION_TOKEN
- GHL_LOCATION_ID
- GHL_AUTH_MODE=private_token
- GHL_API_VERSION=2021-07-28
- GHL_BASE_URL=https://services.leadconnectorhq.com

Use mock mode first:
- REPORTING_DATA_SOURCE=mock
