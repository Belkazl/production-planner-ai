# Equipment styling — OpenAI Apps SDK UI

The vendored CSS files are unchanged from https://github.com/openai/apps-sdk-ui/tree/0f00143c7a639906f1621fe58e1b6be7b5bea46d (MIT, see vendor/LICENSE). build.mjs only namespaces component classes, expands CSS compile helpers and scopes the required original variables. integration.css handles existing LiftOrbit table geometry, card layout and native-control compatibility. The input uses official size md, and SelectControl uses official size xl, both pill and outline. A lightweight vanilla adapter uses original native fields as the single source of truth, with accessible listbox interactions. No native optimizer, timing formula or user model migration is modified.

Original internal ChatGPT card CSS is not part of the SDK; the card's spacing/layout is integrated from the requested reference using the SDK tokens.
