import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {css,sourceTokens} from "./build.mjs";
import {transformPage,patchSource,installEquipmentSDK} from "./patch.mjs";
test("original source sizes, colors and menu shadow; only scoped CSS and markup",()=>{
 assert.equal(sourceTokens["--control-size-md"],"2rem");assert.equal(sourceTokens["--control-size-xl"],"2.5rem");assert.equal(sourceTokens["--radius-full"],"9999px");
 assert(css.includes("box-shadow: var(--shadow), var(--shadow-hairline)"));assert(css.includes("box-shadow: 0 0 0 1px var(--input-outline-border-color) inset"));assert(css.includes("padding: var(--menu-item-padding)"));assert(!css.includes("@mixin"));
 const html='<html><head><style id="ppPerformanceColumnsStyle">.old{}</style></head><body><!-- PP_EQUIPMENT_CALCULATION_MODES_V1 --><script>const untouched="native calculation";</script></body></html>';
 const out=transformPage(html);assert.notEqual(out,html);assert.equal(transformPage(out),out);assert(out.includes('const untouched="native calculation"'));assert(!out.includes('id="ppPerformanceColumnsStyle"'));
 new vm.Script("("+installEquipmentSDK.toString()+")()");
 for(const a of ["const assistantHtml=ppCalculationModesPage(ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))))));","const assistantHtml=ppCalculationModesPage(ppPerformanceColumnsPage(ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))))))));"])new vm.Script(patchSource("function f(branded){"+a+"return assistantHtml;}"));
});
