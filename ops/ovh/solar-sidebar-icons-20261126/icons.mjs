import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
export const mapping=[
  {
    "key": "chat",
    "names": [
      "Chat",
      "Чат"
    ],
    "icon": "chat-round-dots-linear"
  },
  {
    "key": "production",
    "names": [
      "Production",
      "Производство"
    ],
    "icon": "buildings-2-linear"
  },
  {
    "key": "orders",
    "names": [
      "Orders",
      "Заказы"
    ],
    "icon": "clipboard-list-linear"
  },
  {
    "key": "materials",
    "names": [
      "Materials",
      "Материалы"
    ],
    "icon": "box-linear"
  },
  {
    "key": "equipment",
    "names": [
      "Equipment",
      "Оборудование"
    ],
    "icon": "cpu-linear"
  },
  {
    "key": "employees",
    "names": [
      "Employees",
      "Staff",
      "Сотрудники",
      "Персонал"
    ],
    "icon": "users-group-rounded-linear"
  },
  {
    "key": "plan",
    "names": [
      "Plan",
      "Planning",
      "План",
      "Планирование"
    ],
    "icon": "calendar-linear"
  },
  {
    "key": "analytics",
    "names": [
      "Analytics",
      "Аналитика"
    ],
    "icon": "chart-2-linear"
  },
  {
    "key": "scenarios",
    "names": [
      "Scenarios",
      "Сценарии"
    ],
    "icon": "layers-linear"
  },
  {
    "key": "settings",
    "names": [
      "Settings",
      "Настройки"
    ],
    "icon": "settings-linear"
  }
];
const packageRoot=process.env.PP_SOLAR_PACKAGE_ROOT||"/tmp/liftorbit-solar-test/node_modules/@iconify-json/solar";
const collection=JSON.parse(readFileSync(packageRoot+"/icons.json","utf8"));
assert.equal(collection.prefix,"solar");
export const icons=mapping.map(item=>{
 const direct=collection.icons[item.icon],alias=collection.aliases?.[item.icon];
 const icon=direct||(alias&&!alias.hFlip&&!alias.vFlip&&!alias.rotate?collection.icons[alias.parent]:null);
 assert(icon&&typeof icon.body==="string","Missing exact Solar Linear icon: "+item.icon);
 assert.equal(icon.width??collection.width??24,24);
 assert.equal(icon.height??collection.height??24,24);
 assert(!/<(?:script|foreignObject|iframe|image|use|style)\b|\bon\w+\s*=|\b(?:href|src)\s*=|url\s*\(/i.test(icon.body),"Unexpected SVG content");
 assert(/currentColor/.test(icon.body),"SVG must inherit the navigation color");
 return {...item,body:icon.body};
});
