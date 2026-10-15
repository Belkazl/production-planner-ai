# PlanTrick — Production planning landing

First working landing concept for small and medium manufacturers.

## Architectural intent
- This branch is a **standalone source tree**, separate from the production planning application.
- Deploy as an **independent Railway service** in the existing project.
- Static HTML/CSS/JavaScript served by Bun, with no app database credentials, cookies, back-end account service or write endpoints.
- Entirely responsive and accessible; semantic sections, trial explanation dialog, toggleable example Gantt views and FAQ.
- The **Start free trial** buttons open an explicit preview notice and can then open the existing login/registration interface. They **do not** start a real trial or collect payment. Trial automation and subscriptions are a separate future feature.
- Demo Gantt in the design is **illustrative**; do not present it as independently measured optimization performance.
- No invented subscription prices, customer logos or performance claims.

## Run
\`\`\`sh
bun server.ts
\`\`\`
Open http://localhost:3000/ or GET /health.

## Future development
- Confirm final name, custom domain, currency and plan price.
- Connect real 30-day trial account enrollment and automatic entitlement management.
- Add multilingual landing translations and legal pages.
- Design QA on small screens, as well as screen reader / keyboard navigation.
