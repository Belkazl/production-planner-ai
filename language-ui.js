(function(){
"use strict";
if(window.__PP_LANGUAGE__)return;

// UI-only localization. Do not translate model payloads, API requests, user input,
// project names, saved plans or free-form AI conversations.
const KEY="prodplan.ui.language.v1";
const DB="prodplan-ui-preferences";
let preferenceRevision=0;
function storeInDb(value){
 try{
  if(!("indexedDB" in window))return;
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings")};
  request.onsuccess=()=>{
   try{
    const db=request.result;
    const tx=db.transaction("settings","readwrite");
    tx.objectStore("settings").put(value,"language");
    tx.oncomplete=()=>db.close();
    tx.onerror=()=>db.close();
   }catch(_){}
  };
 }catch(_){}
}
function readFromDb(onResult){
 try{
  if(!("indexedDB" in window))return;
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings")};
  request.onsuccess=()=>{
   try{
    const db=request.result,tx=db.transaction("settings","readonly");
    const get=tx.objectStore("settings").get("language");
    get.onsuccess=()=>onResult(get.result);
    tx.oncomplete=()=>db.close();
   }catch(_){}
  };
 }catch(_){}
}
function readStoredLanguage(){
 for(const source of [sessionStorage,localStorage]){
  try{const value=source.getItem(KEY);if(value==="en"||value==="ru")return value}catch(_){}
 }
 return null;
}
const texts={
 // Authentication and top-level navigation
 "Вход — ProdPlan AI":"Sign in — ProdPlan AI",
 "Производственное планирование":"Production planning",
 "Войти":"Sign in",
 "Регистрация":"Register",
 "Компания":"Company",
 "Пароль":"Password",
 "Создать аккаунт":"Create account",
 "Ошибка авторизации":"Authentication failed",
 "Сессия не подтверждена. Повторите вход.":"Session could not be verified. Please sign in again.",
 "Выйти":"Log out",
 "Выходим…":"Logging out…",
 "Не удалось завершить сеанс":"Could not log out",
 "Проекты":"Projects",
 "Планирование":"Planning",
 "Аналитика":"Analytics",
 "Сценарии":"Scenarios",
 "Документы":"Documents",
 "Чат":"Chat",
 "Производство":"Production",
 "Заказы":"Orders",
 "Материалы":"Materials",
 "Оборудование":"Equipment",
 "Сотрудники":"Employees",
 "План":"Plan",
 "Настройки":"Settings",
 "Производство становится понятным":"Production made clear",
 "AI-помощник":"AI Assistant",
 "Свернуть AI-помощника":"Collapse AI assistant",
 "Свернуть":"Collapse",
 "Развернуть":"Expand",
 "Задать вопрос...":"Ask a question...",
 "Опишите производство или добавьте ограничение...":"Describe your production or add a constraint...",
 "Отправить":"Send",
 "Online":"Online",

 // Planning page and Gantt
 "Производственный план":"Production Schedule",
 "Гантт оборудования":"Equipment Gantt",
 "Гантт сотрудников":"Employee Gantt",
 "Гант оборудования":"Equipment Gantt",
 "Гант сотрудников":"Employee Gantt",
 "Занятость автоклавов":"Autoclave utilization",
 "Загрузка ресурсов":"Resource utilization",
 "Узкие места":"Bottlenecks",
 "Ключевые показатели":"Key metrics",
 "Модель производства":"Production model",
 "Ожидание оператора":"Operator wait",
 "ожидание оператора":"operator wait",
 "Простой оборудования":"Equipment idle time",
 "простой оборудования":"equipment idle time",
 "Простой":"Idle time",
 "Валидатор":"Validator",
 "Выгрузка":"Export",
 "Загрузка":"Load",
 "Процесс":"Process",
 "Циклы":"Cycles",
 "циклов":"cycles",
 "минут":"minutes",
 "мин":"min",
 "Мин.":"Min.",
 "мс":"ms",
 "Оптимизировать:":"Optimize for:",
 "Минимальное время":"Shortest duration",
 "Минимум ожидания сотрудников":"Minimum employee waiting",
 "Минимум простоя оборудования":"Minimum equipment idle time",
 "Минимум циклов / запусков":"Minimum cycles / runs",
 "Сбалансированный":"Balanced",
 "Общее время":"Total duration",
 "Число циклов":"Number of cycles",
 "Лучший найденный":"Best found",
 "Тестируемый вариант":"Candidate plan",
 "Лучший найденный вариант":"Best found plan",
 "Сохранить план":"Save plan",
 "Сохранённые планы":"Saved plans",
 "Начать оптимизацию заново":"Start optimization again",
 "Продолжить оптимизацию":"Continue optimization",
 "Запустить оптимизацию":"Start optimization",
 "Остановить оптимизацию":"Stop optimization",
 "Останавливаю...":"Stopping...",
 "Продолжаю оптимизацию...":"Continuing optimization...",
 "Оптимизация GA...":"GA optimization...",
 "Сбрасываю предыдущий поиск…":"Resetting previous search…",
 "Не удалось сбросить оптимизацию":"Failed to reset optimization",
 "Управление оптимизацией ещё не готово":"Optimization controls are not ready yet",
 "Новый поиск · всего 0 поколений · запуск 0":"New search · 0 generations · run 0",
 "Новый расчёт: выбираем первый лучший план. Предыдущие результаты сброшены.":"New run: establishing the first baseline plan. Previous search results cleared.",
 "Сбросить показатели текущего поиска и получить новый исходный план. Сохранённые планы останутся без изменений.":"Reset the current search and generate a new baseline plan. Saved plans will not be changed.",
 "GA: план валиден":"GA: valid plan",
 "GA: есть ошибки":"GA: errors found",
 "GA: план выбран":"GA: plan selected",
 "GA: остановлено · план выбран":"GA: stopped · plan selected",
 "GA: остановлено · выбери вариант":"GA: stopped · choose a plan",
 "GA: остановлено · прежний план сохранён":"GA: stopped · previous plan kept",
 "GA: остановлено, нет готовых вариантов":"GA: stopped · no completed candidates",
 "GA: остановка пока недоступна":"GA: stopping is not available yet",
 "GA: остановлено, нет готовых вариантов":"GA: stopped · no completed candidates",
 "GA: новый поиск · 0/240":"GA: new search · 0/240",
 "GA: улучшения нет":"GA: no improvement",
 "GA: продолжаю поиск":"GA: continuing search",
 "GA: ручная фиксация":"GA: manual overrides",
 "Ошибка GA":"GA error",
 "Есть нарушения":"Constraint violations",
 "Не хватает материала":"Insufficient materials",
 "Модель готова":"Model ready",
 "Модель не завершена":"Model incomplete",
 "Модель ещё не создана":"No model created yet",
 "Модель ещё не создана.":"No model created yet.",
 "Ожидаю данные":"Waiting for data",
 "Нужны данные":"Data required",
 "Готово к расчёту":"Ready to optimize",
 "Данные ещё не заданы.":"No data entered yet.",
 "Оптимизация ещё не запускалась.":"Optimization has not been run yet.",
 "Идёт оптимизация":"Optimization in progress",
 "План валиден":"Valid plan",
 "✓ 0 нарушений ограничений":"✓ No constraint violations",
 "✓ Сохранённый валидный план":"✓ Saved valid plan",
 "Сохранённый план":"Saved plan",
 "Сохранённый расчёт":"Saved optimization",
 "План показан на Ганте":"Plan shown on Gantt",
 "Оптимизация остановлена":"Optimization stopped",
 "Выбор плана после остановки":"Choose plan after stopping",
 "Выбрать и показать на Ганте":"Select and show on Gantt",
 "Оставить прежний план":"Keep previous plan",
 "Лучший найденный":"Best found",
 "Цель":"Objective",
 "Корректных вариантов":"Valid candidates",
 "Улучшение":"Improvement",
 "Вариант":"Variant",
 "Партия":"Batch",
 "Заказ":"Order",
 "Операция":"Operation",
 "Переналадка":"Setup",
 "Поставка материала":"Material delivery",
 "Расход материала":"Material consumption",
 "Ожидание материала":"Waiting for materials",
 "Время начала":"Start time",
 "Время окончания":"End time",
 "Время":"Time",
 "Длительность":"Duration",
 "Количество":"Quantity",
 "Единица":"Unit",
 "Параметр":"Parameter",
 "От состояния":"From state",
 "К состоянию":"To state",
 "Оборудование (ID)":"Equipment (ID)",
 "Сотрудники (ID)":"Employees (ID)",
 "ID операции":"Operation ID",
 "Правило / операция":"Rule / operation",
 "Событие":"Event",
 "Ресурс":"Resource",
 "Причина":"Reason",
 "Сведения":"Details",
 "Нет дополнительных сведений":"No further details",
 "Закрыть сведения об операции":"Close operation details",
 "Операция переналадки":"Setup operation",
 "Событие движения материала":"Material movement event",
 "Блокировка выполнения заказа":"Order blocked",
 "Производственная операция":"Production operation",
 "Ожидание материалов":"Waiting for materials",

 // Documents and Excel imports
 "Импорт данных":"Import data",
 "Шаблоны и загрузка производственных данных":"Templates and production data import",
 "Скачайте шаблон Excel, заполните необходимые листы и загрузите файл для проверки данных перед импортом.":"Download the Excel template, complete the required sheets, and upload the file to validate data before importing.",
 "Скачать шаблон":"Download template",
 "Загрузить данные":"Upload data",
 "Импорт":"Import",
 "Импортировать":"Import",
 "Импортирую...":"Importing...",
 "Сохранить изменения":"Save changes",
 "Сохраняю...":"Saving...",
 "Сохранено":"Saved",
 "Ошибка":"Error",
 "Предпросмотр":"Preview",
 "Проверить данные":"Validate data",
 "Отмена":"Cancel",
 "Отменить":"Cancel",
 "Применить":"Apply",
 "Готово":"Done",
 "Закрыть":"Close",
 "Удалить":"Delete",
 "Да":"Yes",
 "Нет":"No",

 // Projects and administration
 "Проект не выбран":"No project selected",
 "Новый проект":"New project",
 "+ Новый проект":"+ New project",
 "+ Создать проект":"+ Create project",
 "Создать проект":"Create project",
 "Создайте первое производство":"Create your first production project",
 "Поиск по проектам":"Search projects",
 "Один проект — одно производство. В проекте отдельно сохраняются модель, чат, последний план и история оптимизаций.":"One project represents one production facility. Its model, chat, latest plan, and optimization history are saved separately.",
 "Один проект = одно производство · автосохранение включено":"One project = one production facility · autosave enabled",
 "Проекты сохраняются автоматически в этом браузере. Экспорт создаёт резервную копию JSON.":"Projects are saved automatically in this browser. Export creates a JSON backup.",
 "Экспорт всех":"Export all",
 "Сохранить":"Save",
 "Название проекта":"Project name",
 "Новое производство":"New production",
 "Создать":"Create",
 "Изменить название":"Rename",
 "Переименовать":"Rename",
 "Открыть проект":"Open project",
 "Открыть проекты":"Open projects",
 "Удалить проект":"Delete project",
 "Импорт проекта":"Import project",
 "Экспорт проекта":"Export project",
 "Сохранённый план открыт":"Saved plan opened",
 "Продолжить поиск":"Continue search",
 "Количество проектов":"Project count",
 "Все проекты":"All projects",
 "История оптимизаций":"Optimization history",

 // Production model editors
 "Редактирование данных":"Edit data",
 "Редактирование заказов":"Edit orders",
 "Измените значения и нажмите «Сохранить изменения».":"Edit the values, then click Save changes.",
 "+ Добавить":"+ Add",
 "+ Добавить заказ":"+ Add order",
 "+ Добавить материал":"+ Add material",
 "+ Добавить операцию":"+ Add operation",
 "+ Добавить ресурс":"+ Add resource",
 "+ Добавить правило":"+ Add rule",
 "+ Создать связь":"+ Create link",
 "+ Техпроцесс":"+ Process",
 "+ параметр":"+ parameter",
 "Название":"Name",
 "Тип":"Type",
 "Кол.":"Qty.",
 "Количество":"Quantity",
 "Ед.":"Unit",
 "Объём выпуска":"Production volume",
 "Техпроцесс":"Process",
 "Техпроцессы":"Processes",
 "Производственные параметры":"Production parameters",
 "Производственные параметры заказа":"Order production parameters",
 "Производственные параметры отличаются у конкретных заказов и могут управлять переналадками универсального техпроцесса.":"Production parameters vary by order and can control setup rules for a shared manufacturing process.",
 "Техпроцесс состоит из операций. Одна операция может одновременно требовать любое количество сотрудников, оборудования и материалов.":"A process consists of operations. Each operation may require any number of employees, machines, and materials at the same time.",
 "Оборудование / группа":"Equipment / group",
 "Ресурс / группа":"Resource / group",
 "Оборудование и группы":"Equipment and groups",
 "Требования к ресурсам":"Resource requirements",
 "Выбор":"Selection",
 "Конкретный":"Specific",
 "Любой подходящий":"Any suitable",
 "Все подходящие":"All suitable",
 "Все оборудование":"All equipment",
 "Любое оборудование":"Any equipment",
 "Любой сотрудник":"Any employee",
 "Любое значение":"Any value",
 "Любой параметр":"Any parameter",
 "Не нужен":"Not required",
 "Не требуется":"Not required",
 "— Выберите значение —":"— Select a value —",
 "— Выберите техпроцесс —":"— Select a process —",
 "— Параметр заказа —":"— Order parameter —",
 "Вместимость, м²":"Capacity, m²",
 "Коэф. процесса":"Process factor",
 "На единицу":"Per unit",
 "На м²":"Per m²",
 "На операцию":"Per operation",
 "На время операции":"During operation",
 "Параллельно":"In parallel",
 "Удерживать":"Hold",
 "Связь":"Link",
 "Расход":"Consumption",
 "Остаток":"Stock",
 "Поставка":"Delivery",
 "Дата":"Date",
 "График":"Schedule",
 "Смена":"Shift",
 "Смены":"Shifts",
 "Роль":"Role",
 "Роли":"Roles",
 "Роли сотрудников":"Employee roles",
 "Правило":"Rule",
 "Правила":"Rules",
 "Правил":"Rules",
 "Переналадки оборудования":"Equipment setup rules",
 "Переналадка: нет":"Setup: none",
 "Сохранить переналадки":"Save setup rules",
 "Запрет":"Forbidden",
 "Запретить этот переход":"Forbid this transition",
 "Из значения":"From value",
 "В значение":"To value",
 "Параметр заказа":"Order parameter",
 "Какой параметр конкретного заказа определяет переналадку этой операции":"Which order-specific parameter controls this operation's setup",
 "Не освобождать ресурс между связанными операциями":"Keep the resource reserved between linked operations",
 "Одинаковая связь заставляет использовать тот же конкретный ресурс в операциях одного заказа":"The same link requires the same physical resource across an order's operations",
 "Добавляйте только реальные переналадки. Если перехода в таблице нет — переналадка не требуется и её время равно 0. «Любое значение» можно использовать для общего правила.":"Add only actual setup changes. If a transition is missing, no setup is needed and its duration is zero. Use Any value for a general rule.",
 "Материалов может быть сколько угодно. Расход задаётся внутри операций.":"You can add any number of materials. Consumption is defined within operations.",
 "Параметр, напр. Программа обжига":"Parameter, e.g. Firing program",
 "Значение, напр. 1200°C":"Value, e.g. 1200°C",
 "Сбросить ручные правки":"Reset manual edits",
 "Ручные правки":"Manual edits",
 "Отменить все правки":"Discard all edits",
 "Начало":"Start",
 "Конец":"End",
 "Старт":"Start",
 "Статус":"Status",
 "Тип ресурса":"Resource type",

 // Typical demo values shown as option labels; model IDs/values are never modified
 "Прессование":"Pressing",
 "Сушка":"Drying",
 "Обжиг":"Firing",
 "Глазурование":"Glazing",
 "Сортировка":"Sorting",
 "Упаковка":"Packaging",
 "Цифровая декорация":"Digital decoration",
 "Глазурь/цвет":"Glaze / color",
 "Дизайн печати":"Print design",
 "Режим обжига":"Firing mode",
 "Формат пресса":"Press format",
 "Бежевый":"Beige",
 "Белый":"White",
 "Серый":"Gray",
 "Чёрный":"Black",
 "Большой":"Large",
 "Малый":"Small",
 "Другой":"Other",
 "Дневная":"Day shift",
 "Оператор ОТК":"Quality inspector",
 "Оператор глазурования":"Glazing operator",
 "Оператор прессования":"Press operator",
 "Оператор упаковки":"Packaging operator",
 "Оператор цифровой печати":"Digital printing operator",
 "Контроль качества":"Quality control",
 "Группа: pressing":"Group: pressing",
 "Группа: drying":"Group: drying",
 "Группа: firing":"Group: firing",
 "Группа: glazing":"Group: glazing",
 "Группа: decoration":"Group: decoration",
 "Группа: sorting":"Group: sorting",
 "Группа: packaging":"Group: packaging",
 "Автоклавы":"Autoclaves",
 "Данные":"Data",

 // Longer status and explanatory sentences
 "Планирование ещё не запускалось":"Scheduling has not started",
 "Новый поиск":"New search",
 "Нет улучшения":"No improvement",
 "Улучшения нет — текущий план сохранён.":"No improvement — the current plan is preserved.",
 "Новый вариант не применён: он невалиден.":"Candidate was not applied because it is invalid.",
 "Новый вариант не применён: он частичный.":"Candidate was not applied because it is incomplete.",
 "Нет доступных вариантов":"No candidates available",
 "Сохранённых планов нет":"No saved plans",
 "Отсутствуют данные":"No data available",
 "Сохранить текущий план":"Save current plan",
 "План сохранён":"Plan saved",
 "Новый вариант не применён":"Candidate not applied",
 "Все операции":"All operations",
 "Завершить":"Finish",
 "Проверка":"Validation",
 "Обновить":"Refresh",
 "Назад":"Back",
 "Далее":"Next",
 "Ок":"OK",
 "ОК":"OK"
};

const trMap=new Map(Object.entries(texts));
const ruOnly=/[\u0400-\u04ff]/;
const nodeStore=new WeakMap(),attributeStore=new WeakMap();
let lang="en",started=false,resettingUi=false,frame=0;
const changed=new Set();

function dynamic(text){
 let m;
 if((m=/^Сохранённые планы \((\d+)\)$/.exec(text)))return "Saved plans ("+m[1]+")";
 if((m=/^(\d+) из (\d+)$/.exec(text)))return m[1]+" of "+m[2];
 if((m=/^(\d+) параметр(?:ов|а)?$/.exec(text)))return m[1]+" parameters";
 if((m=/^Правил:\s*(\d+)$/.exec(text)))return "Rules: "+m[1];
 if((m=/^Тип:\s*(.+)$/.exec(text)))return "Type: "+m[1];
 if((m=/^Группа:\s*(.+)$/.exec(text)))return "Group: "+m[1];
 if((m=/^По параметру:\s*(.+)$/.exec(text)))return "By parameter: "+translate(m[1]);
 if((m=/^Любой:\s*(.+)$/.exec(text)))return "Any: "+translate(m[1]);
 if((m=/^Производственные параметры заказа (.+)$/.exec(text)))return "Production parameters for order "+m[1];
 if((m=/^(\d+) (мин|мс|ч|час(?:а|ов)?|цикл(?:ов|а)?|поколени(?:й|я|е))$/.exec(text))){
  const units={"мин":"min","мс":"ms","ч":"h","час":"hours","часа":"hours","часов":"hours",
   "циклов":"cycles","цикла":"cycles","цикл":"cycle","поколений":"generations","поколения":"generations","поколение":"generation"};
  return m[1]+" "+(units[m[2]]||m[2]);
 }
 if((m=/^Выбран вариант ([\d.,]+) мин\. План показан на Ганте и ещё не сохранён\.$/.exec(text)))
  return "Selected plan: "+m[1]+" min. Shown on the Gantt chart; not saved yet.";
 if((m=/^Корректных вариантов:\s*(\d+)$/.exec(text)))return "Valid candidates: "+m[1];
 if((m=/^Вариант (\d+) — ([\d.,]+) мин · (.+): ([\d.,]+)$/.exec(text)))
  return "Variant "+m[1]+" — "+m[2]+" min · "+translate(m[3])+": "+m[4];
 if((m=/^Лучший найденный — ([\d.,]+) мин · (.+): ([\d.,]+)$/.exec(text)))
  return "Best found — "+m[1]+" min · "+translate(m[2])+": "+m[3];
 if((m=/^Оптимизация (\d+)%$/.exec(text)))return "Optimization "+m[1]+"%";
 if((m=/^Оптимизация (\d+)% · завершаю$/.exec(text)))return "Optimization "+m[1]+"% · finishing";
 if((m=/^GA: (.+) · (\d+)%$/.exec(text)))return "GA: "+translate(m[1])+" · "+m[2]+"%";
 if((m=/^GA: (.+)$/.exec(text))){
  const tail=m[1],mapped=trMap.get(tail);
  if(mapped)return "GA: "+mapped;
  // Rendered progress/status is not a model value; translate its known segments.
  return "GA: "+tail.replace(/оптимизация/g,"optimizing")
   .replace(/остановлено/g,"stopped").replace(/расчёт завершён/g,"completed")
   .replace(/расчёт остановлен/g,"stopped").replace(/новый поиск/g,"new search")
   .replace(/поиск вариантов/g,"searching candidates").replace(/план валиден/g,"valid plan")
   .replace(/план выбран/g,"plan selected").replace(/есть ошибки/g,"errors found")
   .replace(/запуск\s+(\d+)/g,"run $1").replace(/(\d+)\s*поколений/g,"$1 generations");
 }
 if(text.startsWith("GA · ")||text.startsWith("Новый поиск · ")||
    text.startsWith("Сохранённый расчёт · ")){
  let t=text.replace(/^Новый поиск/,"New search").replace(/^Сохранённый расчёт/,"Saved optimization");
  return t.replace(/всего\s+(\d+)\s+поколени(?:й|я|е)/g,"$1 generations total")
   .replace(/запуск\s+(\d+)/g,"run $1").replace(/улучшение\s+([-\d.,]+)\s+мин/g,"improvement $1 min")
   .replace(/(?:новый вариант отклонён)/g,"candidate rejected")
   .replace(/текущий план сохранён/g,"current plan preserved")
   .replace(/(\d+)\s+мс/g,"$1 ms").replace(/поколений/g,"generations");
 }
 if((m=/^Новый вариант не применён:\s*(.+)$/.exec(text))){
  const why=m[1].replace(/^ухудшены/,"worse:").replace(/Текущий план сохранён/g,"Current plan preserved")
    .replace(/длительность/g,"duration").replace(/ожидание/g,"waiting")
    .replace(/простой/g,"idle time").replace(/число циклов/g,"cycle count");
  return "Candidate not applied: "+why;
 }
 if((m=/^Не удалось начать заново:\s*(.+)$/.exec(text)))
  return "Could not restart optimization: "+m[1];
 if((m=/^Сохранённые планы \((\d+)\)$/.exec(text)))return "Saved plans ("+m[1]+")";
 if((m=/^Демо «([^»]+)» загружено:\s*(\d+) единиц оборудования,\s*(\d+) заказов на ([\d\s]+) м² и технологический процесс из (\d+) операций\. Партии формируются по ([\d\s]+) м² с фактическим хвостом; длительность операций зависит от выбранного оборудования и объёма партии, совместимость оборудования учитывается автоматически\. Можно запускать оптимизацию\.$/.exec(text))){
  return "Demo “"+m[1]+"” loaded: "+m[2]+" machines, "+m[3]+" orders totaling "+m[4].trim()+" m², and a process with "+m[5]+" operations. Batches are sized at "+m[6].trim()+" m² with a remainder when needed. Operation times depend on the selected equipment and batch size; equipment compatibility is handled automatically. Optimization is ready to start.";
 }
 return null;
}
function translate(t){
 const key=String(t||"").trim();
 if(!key)return String(t||"");
 const value=trMap.get(key);
 if(value!==undefined)return value;
 const d=dynamic(key);
 return d===null?key:d;
}
function transformText(node){
 if(!node||node.nodeType!==3||!node.parentElement)return;
 const parent=node.parentElement;
 if(parent.closest("script,style,noscript,textarea,svg,code,pre,[contenteditable],.pp-i18n-route-label"))return;
 // Free-form chat is user/project content. Only the known demo greeting can be localized.
 if(parent.closest("#messages")&&!String(node.nodeValue||"").trim().startsWith("Демо «"))return;
 const current=node.nodeValue||"",stored=nodeStore.get(node);
 if(lang==="ru"){
  if(stored&&current===stored.en&&stored.ru!==stored.en)node.nodeValue=stored.ru;
  return;
 }
 if(!ruOnly.test(current))return;
 const ru=stored&&current===stored.ru?stored.ru:current;
 const tr=translate(ru);
 if(ru===tr)return;
 nodeStore.set(node,{ru,en:tr});
 if(current!==tr)node.nodeValue=tr;
}
function transformAttrs(el){
 if(!el||el.nodeType!==1||el.matches("script,style,noscript"))return;
 const existing=attributeStore.get(el)||new Map();
 for(const name of ["placeholder","title","aria-label","alt"]){
  const value=el.getAttribute(name);
  if(value===null)continue;
  const old=existing.get(name);
  if(lang==="ru"){
   if(old&&value===old.en&&old.ru!==old.en)el.setAttribute(name,old.ru);
   continue;
  }
  if(!ruOnly.test(value))continue;
  const ru=old&&value===old.ru?old.ru:value,tr=translate(ru);
  if(ru===tr)continue;
  existing.set(name,{ru,en:tr});
  if(value!==tr)el.setAttribute(name,tr);
 }
 if(existing.size)attributeStore.set(el,existing);
}
const ROUTE_SELECTOR=".top .nav > span, .side > .item, #planView .tabs > div";
function preserveRouteLabel(el){
 if(!el||el.nodeType!==1||el.querySelector(":scope > .pp-i18n-route-label"))return;
 const child=[...el.childNodes].find(n=>n.nodeType===3&&ruOnly.test(n.nodeValue||""));
 if(!child)return;
 const ru=child.nodeValue.trim();
 const en=translate(ru);
 if(en===ru)return;
 const label=document.createElement("b");
 label.className="pp-i18n-route-label";
 label.dataset.ppEn=en;
 label.style.setProperty("--pp-lang-font-size",getComputedStyle(el).fontSize);
 // The Russian DOM text is retained for the upstream app's existing
 // textContent-based navigation and Gantt routing.
 child.replaceWith(label);
 label.appendChild(child);
 el.dataset.ppEnLabel=en;
 el.setAttribute("aria-label",lang==="en"?en:ru);
}
function prepare(root){
 if(!root||root.nodeType!==1&&root.nodeType!==9)return;
 if(root.matches?.(ROUTE_SELECTOR))preserveRouteLabel(root);
 for(const el of root.querySelectorAll?.(ROUTE_SELECTOR)||[])preserveRouteLabel(el);
 // The manual-edit reset handler also intentionally compares button.textContent.
 for(const btn of root.querySelectorAll?.("button")||[]){
  if(btn.textContent.trim()==="Сбросить ручные правки")preserveRouteLabel(btn);
 }
}
function translateBranch(root){
 if(!root)return;
 if(root.nodeType===3){transformText(root);return}
 if(root.nodeType!==1&&root.nodeType!==9)return;
 prepare(root);
 if(root.nodeType===1)transformAttrs(root);
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const n=walker.currentNode;
  if(n.nodeType===3)transformText(n);
  else if(n.nodeType===1)transformAttrs(n);
 }
}
function refresh(){
 resettingUi=true;
 try{
  document.documentElement.lang=lang;
  translateBranch(document.body);
  // Browser/tab title is outside the body.
  if(document.title==="Вход — ProdPlan AI"&&lang==="en")document.title="Sign in — ProdPlan AI";
  else if(document.title==="Sign in — ProdPlan AI"&&lang==="ru")document.title="Вход — ProdPlan AI";
  for(const el of document.querySelectorAll("[data-pp-en-label]")){
   el.setAttribute("aria-label",lang==="en"?el.dataset.ppEnLabel:el.textContent.trim());
  }
  const select=document.getElementById("ppLanguageSelect");
  if(select&&select.value!==lang)select.value=lang;
  const switchLabel=document.querySelector(".pp-language-label");
  if(switchLabel)switchLabel.textContent=lang==="ru"?"Язык":"Language";
 }finally{resettingUi=false}
}
function selectLanguage(value){
 if(value!=="en"&&value!=="ru")return;
 ++preferenceRevision;
 lang=value;
 try{sessionStorage.setItem(KEY,lang)}catch(_){}
 try{localStorage.setItem(KEY,lang)}catch(_){}
 storeInDb(lang);
 refresh();
 window.dispatchEvent(new CustomEvent("pp:language-changed",{detail:{language:lang}}));
}
function control(){
 if(document.getElementById("ppLanguageControl"))return true;
 const auth=document.getElementById("ppProtectedAccount");
 const login=document.querySelector("body > .box");
 const holder=auth||login;
 if(!holder)return false;
 const container=document.createElement("label");
 container.className="pp-language-control";
 container.id="ppLanguageControl";
 container.setAttribute("for","ppLanguageSelect");
 container.setAttribute("aria-label","Language / Язык");
 const label=document.createElement("span");
 label.className="pp-language-label";label.textContent="Language";
 const select=document.createElement("select");
 select.id="ppLanguageSelect";select.setAttribute("aria-label","Language / Язык");
 for(const [value,name] of [["en","English"],["ru","Русский"]]){
  const option=document.createElement("option");
  option.value=value;option.textContent=name;select.appendChild(option);
 }
 select.value=lang;
 select.addEventListener("change",()=>selectLanguage(select.value));
 container.append(label,select);
 if(auth)auth.insertBefore(container,auth.firstChild);
 else login.insertBefore(container,login.firstChild);
 return true;
}
function processQueue(){
 frame=0;
 if(resettingUi||!document.body)return;
 const roots=[...changed];changed.clear();
 if(!roots.length)return;
 for(const root of roots){if(root?.isConnected||root===document.body)translateBranch(root)}
 // The editor often inserts detached table fragments and then replaces its
 // table body. Sweep only that affected editor once more to catch text written
 // after the original fragment was queued (e.g. "15 параметров").
 if(lang==="en"){
  const editor=document.getElementById("sectionView");
  if(editor&&roots.some(root=>root===editor||editor.contains(root)||root?.contains?.(editor)))
   translateBranch(editor);
 }
 // An account header can be injected by the auth bridge after our own script.
 if(!document.getElementById("ppLanguageControl"))control();
}
function observe(){
 const observer=new MutationObserver(mutations=>{
  if(resettingUi)return;
  for(const m of mutations){
   const target=m.type==="characterData"?m.target:m.target;
   if(target===document.getElementById("ppLanguageSelect"))continue;
   if(m.type==="attributes"&&m.target?.closest?.(".pp-language-control"))continue;
   if(m.type==="childList"&&m.addedNodes.length){
    for(const added of m.addedNodes){
     if(added.nodeType===1||added.nodeType===3)changed.add(added);
    }
   }else if(target?.nodeType===1||target?.nodeType===3)changed.add(target);
  }
  if(changed.size>220){changed.clear();changed.add(document.body)}
  if(changed.size&&!frame)frame=requestAnimationFrame(processQueue);
 });
 observer.observe(document.body,{
  childList:true,subtree:true,characterData:true,
  attributes:true,attributeFilter:["placeholder","title","aria-label","alt"]
 });
}
function start(){
 if(started)return;
 started=true;
 const saved=readStoredLanguage();
 lang=saved==="ru"?"ru":"en";
 control();
 refresh();
 observe();
 // The original production project initializer replaces localStorage with
 // authenticated project data on sign-in. Keep the locale in sessionStorage,
 // with independent IndexedDB persistence across tabs/browser restarts.
 if(saved){
  try{sessionStorage.setItem(KEY,saved)}catch(_){}
  storeInDb(saved);
 }else{
  const initialRevision=preferenceRevision;
  readFromDb(value=>{
   if(initialRevision!==preferenceRevision||value!=="ru"&&value!=="en")return;
   selectLanguage(value);
  });
 }
}
window.__PP_LANGUAGE__={
 get current(){return lang},
 set:selectLanguage,
 translate,
 refresh,
 get installed(){return started}
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
else start();
})();