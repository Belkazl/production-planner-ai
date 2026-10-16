// Public learning resources. No planner, account, database or billing code is changed.
export const RELEASE = '2026-10-16-resources-1';
export const ORIGIN = 'https://liftorbit.app';
const DATE = '2026-10-16';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = (path, text) => `<a href="${path}">${text}</a>`;
const calcPath = '/tools/production-capacity-calculator/';
const sourceNote = '<p class="lo-small">Concept reference: <a href="https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/finite-capacity" rel="noopener">Microsoft Learn: finite capacity planning and scheduling</a>. The worked examples in this guide are our own simplified calculations, not Microsoft or customer performance data.</p>';
const callout = (html) => `<aside class="lo-note">${html}</aside>`;
const table = (headers, rows) => `<div class="lo-table-wrap" tabindex="0" role="region" aria-label="Worked example table"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const pages = [
  {path:'/production-capacity-planning/', type:'WebPage', tag:'CAPACITY PLANNING', title:'Production Capacity Planning for Small Manufacturers', description:'Compare production workload with available machine hours. Learn how capacity, setup time and resource constraints affect a realistic manufacturing schedule.', lead:'Before accepting the next order, ask a smaller question: does the required work fit the time your machines actually have?', body:`
<h2>Start with a work centre, not a factory-wide average</h2>
<p>Capacity planning compares the work you need to do with the resource time available in a chosen period. A weekly total is a useful first check, but it cannot tell you whether a particular operation can start on Tuesday. Finite-capacity scheduling takes the next step: it places work against resource limits and existing commitments.</p>
<p>Start with one machine, or a group of genuinely interchangeable machines. Do not add spare packing hours to an overloaded kiln and call the factory balanced. Those hours belong to different resources. For each work centre, record working days, shifts, shift length and time that is unavailable for production.</p>
<h2>A worked weekly capacity check</h2>
<p>Consider two identical machines, each working one eight-hour shift for five days. That gives 80 gross machine-hours. Assume 15% is unavailable because of breaks and maintenance, leaving 68 hours. This allowance excludes changeovers, which we count separately as demand.</p>
${table(['Item','Calculation','Result'],[['Gross capacity','2 machines &times; 1 shift &times; 8 hours &times; 5 days','80 hours'],['Available capacity','80 &times; 85%','68 hours'],['Processing demand','1,000 units &times; 3 minutes / 60','50 hours'],['Setup demand','10 setups &times; 30 minutes / 60','5 hours'],['Total demand','50 + 5','55 hours'],['Planned capacity load','55 / 68 &times; 100','80.9%']])}
<p>The arithmetic leaves 13 machine-hours of headroom. It does <strong>not</strong> prove that every delivery date can be met. Work may arrive late in the week, an operation may require a specific machine, or the same employee may be needed for two jobs at once.</p>
${callout(`Try these figures in the ${link(calcPath,'free production capacity calculator')}. Change the quantity to 1,400 units: demand rises to 75 hours, exceeding the same available capacity by seven hours.`)}
<h2>Turn aggregate capacity into a usable schedule</h2>
<p>For a more detailed plan, list the operation sequence for each order, eligible machines, processing duration, setup requirements and material availability. Check which resources must be available at the same time. Keep waiting time separate from machine occupation: an item waiting for inspection may not occupy a production machine, while a batch cooling inside a kiln still does.</p>
<p>LiftOrbit brings orders, machines, employees, materials and changeovers into a visual production plan. Use the Gantt chart to inspect the order of operations, then compare the initial plan with optimization results. A shorter plan is only useful if the inputs represent your actual production constraints.</p>
<h2>What to do when the week is overloaded</h2>
<p>First check whether the problem is missing data or genuine demand. If the overload is real, compare specific alternatives: a different eligible machine, an additional staffed shift, a revised order sequence or a later commitment. Do not erase setup time just to make the total fit. The ${link('/changeover-planning/','changeover planning guide')} shows why sequence matters.</p>
<p>Repeat the check whenever orders, resource availability or processing estimates change. Compare scenarios using the same input snapshot; otherwise an apparent improvement may simply reflect different assumptions.</p>
${sourceNote}`},
  {path:'/changeover-planning/', type:'WebPage', tag:'CHANGEOVER PLANNING', title:'Machine Changeover Planning and Setup Time', description:'Include machine setup time in production schedules. Work through a sequence-dependent changeover example and compare setup savings with due-date constraints.', lead:'A machine is not available for the next order while it is being cleaned, adjusted or prepared. Put that time in the plan.', body:`
<h2>Make setup time visible</h2>
<p>Processing duration is only part of the time an order needs on a resource. A product change can also require cleaning, tooling, adjustment or preparation. Treat these activities as occupied resource time instead of hiding them in an unexplained gap between orders.</p>
<p>Separate two questions: how long does a change take, and which change is actually required? A fixed setup allowance can be enough for a simple process. Where the previous product affects preparation, use a from-product/to-product rule. The transition from A to B does not have to take the same time as B to A.</p>
<h2>Example: the same orders, a different sequence</h2>
<p>Suppose one machine must process A1, B1 and A2. Each order takes two hours. The machine begins ready for product A. An A-to-A transition takes ten minutes; A-to-B takes 45 minutes; B-to-A takes 60 minutes. Assume all orders and materials are available at the start.</p>
${table(['Sequence','Processing','Changeovers after the first job','Total occupied time'],[['A1 &rarr; B1 &rarr; A2','6 hours','45 + 60 = 105 minutes','7 hours 45 minutes'],['A1 &rarr; A2 &rarr; B1','6 hours','10 + 45 = 55 minutes','6 hours 55 minutes']])}
<p>Grouping the A orders saves 50 minutes in this constructed example. The reduction comes from the stated transition rules, not from faster processing. Initial setup is zero only because the starting machine state was explicitly defined as ready for A.</p>
${callout('<strong>Fewer setups is not automatically a better delivery plan.</strong> In the grouped sequence, B1 finishes at 6 hours 55 minutes rather than 4 hours 45 minutes. If B1 is due after five hours, the sequence with fewer setup minutes misses its deadline.')}
<h2>Define rules before optimizing</h2>
<p>Record the starting state of each machine and the transitions relevant to your product families. Include a same-family setup when inspection or cleaning is still required. When a setup consumes an employee as well as a machine, validate that both can be available. Never use a blank setup value to mean both zero time and unknown time.</p>
<p>Distinguish preparation that can happen while the machine is running from preparation that stops it. Only the latter necessarily occupies machine capacity. If work can happen in parallel, represent that deliberately; do not assume all setup activities can overlap.</p>
<h2>Review the sequence in LiftOrbit</h2>
<p>LiftOrbit supports machine setup rules and displays changeovers in the production Gantt. Build an initial plan from a consistent set of orders, resources and constraints. Then inspect the optimized plan and compare its operation sequence and occupied time with the baseline.</p>
<p>Check that setup blocks remain present, that each transition matches the products on either side, and that required materials are available. Rebuild the baseline when the underlying orders change rather than comparing a new workload with an old plan.</p>
<h2>Use a rough capacity check first</h2>
<p>The ${link(calcPath,'capacity calculator')} accepts a count of setups and an average time per setup. It is useful for a weekly estimate, but it does not choose a sequence or evaluate a transition matrix. For those decisions, model the individual orders and resources in the planner.</p>
<p>For a practical production context, read the ${link('/guides/ceramics-production-planning/','ceramic workshop planning example')}. All timings in this article are illustrative assumptions, not a claim about customer savings or guaranteed optimization performance.</p>`},
  {path:'/guides/production-scheduling-in-excel/', type:'Article', tag:'PRACTICAL GUIDE', title:'Production Scheduling in Excel: What to Track and When to Move On', description:'A practical checklist for spreadsheet production planning: orders, operations, machine capacity, materials, changeovers and fair comparisons with a scheduling tool.', lead:'Keep the spreadsheet useful for as long as it is useful. Move to a scheduler when maintaining a feasible sequence becomes the hard part.', body:`
<h2>A spreadsheet is a starting point, not a mistake</h2>
<p>A small workshop can begin with a spreadsheet that lists orders, quantities and promised dates. When the work follows a simple sequence and one person owns the plan, that can be a practical way to organise information. The question is not whether a spreadsheet is professional enough. It is whether the people using it can keep the resource assignments and timings correct as the work changes.</p>
<p>This checklist is a proposed data structure, not a downloadable Excel template or an automatic import specification for LiftOrbit. Keep a copy of your current sheet before experimenting with a new planning method.</p>
<h2>Separate the information you are maintaining</h2>
${table(['Table or sheet','Minimum information','What to check'],[['Orders','Order ID, product, quantity, release date, due date','Each ID is unique; dates use one convention.'],['Operations','Order ID, sequence, duration, eligible resource','A successor cannot start before its predecessor finishes.'],['Resources','Machine ID, shifts, unavailable periods','Two jobs do not occupy one machine at the same time.'],['Setups','Previous family, next family, occupied time','Starting state and same-family changes are explicit.'],['Materials','Item, available quantity, expected deliveries, consumption','An operation does not consume stock before it arrives.']])}
<p>Choose one duration unit, such as minutes, and label it. Distinguish duration per unit from duration per batch. If three minutes is a per-unit processing time, 200 units require 600 processing minutes before setups. If a two-hour treatment handles the entire batch, multiplying that duration by every item would describe a different process.</p>
<h2>Do not confuse a coloured bar with a checked schedule</h2>
<p>A Gantt-style spreadsheet can communicate the intended sequence, but drawing a bar does not itself validate capacity. For every operation, ask whether the predecessor is finished, the machine is eligible and unoccupied, and the required people and materials are available. A total of 30 hours in a 40-hour week can still contain a Tuesday double booking.</p>
<p>Add a simple ${link('/production-capacity-planning/','capacity check per work centre')} before reviewing exact start times. Keep setup demand separate so it is not forgotten or counted twice. For overlapping operations, inspect the timing rather than relying only on weekly totals.</p>
<h2>Recognise the point where manual changes become risky</h2>
<p>Consider a scheduling tool when a new order repeatedly forces you to move many later operations, when alternative machines create competing choices, or when product sequence changes setup time. Another useful signal is that you no longer know which copy contains the current plan.</p>
<p>These are evaluation triggers, not universal rules or proof that your spreadsheet cannot work. The cost to compare is the time and error risk of maintaining your particular process against the effort of setting up and checking another tool.</p>
<h2>Run a controlled comparison</h2>
<p>Choose a small, representative group of orders rather than your entire production history. Record the same orders, processing times, machine availability, materials and setup rules in both approaches. Save the input snapshot and identify any simplification. Do not compare an old spreadsheet with a planner that contains additional orders.</p>
<p>LiftOrbit lets you organise production data, build a visual plan and compare optimization results. Begin with the baseline schedule and inspect it before interpreting improvements. Test a changed quantity, one unavailable machine and a material delay separately; check that the resulting schedule reflects each change.</p>
<h2>Define what a successful evaluation means</h2>
<p>Use measures you can verify: time spent updating the plan, number of resource conflicts found during review, finishing times for the same set of orders and whether setup time is represented. Do not convert a simulated reduction into a customer success claim. Confirm operational results in your own production before relying on them.</p>
<p>Start with the ${link(calcPath,'free capacity calculator')} when you only need a rough load estimate, or read the ${link('/changeover-planning/','worked changeover example')} when sequencing is the main difficulty.</p>`},
  {path:'/guides/ceramics-production-planning/', type:'Article', tag:'WORKED PRODUCTION EXAMPLE', title:'Ceramic Production Planning: Orders, Kilns and Changeovers', description:'Build a small ceramic workshop planning model. Separate forming, drying, glazing, firing and packing, then check shared resources, materials and setup assumptions.', lead:'Use a ceramic workshop to practise the difference between a list of orders and a resource-constrained production plan.', body:`
${callout('<strong>Illustrative learning example.</strong> LiftOrbit uses a ceramic manufacturing demonstration to explain planning. This article is a simplified modelling exercise, not a customer case study, a measured benchmark or a prescribed ceramic firing process.')}
<h2>Define the process you actually use</h2>
<p>For this exercise, assume orders move through forming, drying, glazing, firing and packing. A real ceramic process may use different steps or multiple firings; replace the example route with the route used in your workshop. Processing and cooling durations must come from your own validated process, not from this article.</p>
<p>Give each operation a predecessor and a resource requirement. A kiln is not interchangeable with a forming station, even if one is idle while the other is busy. A weekly total across both would hide the resource that limits the plan.</p>
<h2>Decide what occupies each resource</h2>
${table(['Step in this exercise','Resource to model','Planning question'],[['Forming','An eligible forming station and any required operator','Is duration per piece, per batch or a combination?'],['Drying','A defined drying area or unit','Does the whole batch occupy limited space while drying?'],['Glazing','The relevant workstation','Does changing glaze require cleaning or preparation?'],['Firing','A compatible kiln','Does the occupied time include loading, processing, cooling and unloading?'],['Packing','Packing station and staff','Can packing begin for a partial order or only a complete batch?']])}
<p>Waiting and occupation are different. If pieces leave a dryer and wait on an unlimited rack, that wait may not consume dryer capacity. If pieces remain inside a kiln while it cools, the kiln is still occupied. Use the same interpretation in every scenario you compare.</p>
<h2>A small bottleneck calculation</h2>
<p>Assume three separate batches need the same kiln. For this arithmetic example only, each batch occupies it for ten hours, including all work that blocks the next batch. The selected planning window offers 24 usable kiln-hours. Demand is 30 hours, leaving a six-hour overload.</p>
<p>An idle packing station does not remove those missing kiln-hours. Nor does a faster forming operation automatically make the three kiln batches fit. To change the outcome, you need a valid change to the kiln plan: another compatible resource, more usable kiln time or a different commitment.</p>
<p>Do not simply merge the three batches to make the numbers fit. Shared firing requires compatibility and physical capacity checks. This example assumes separate batches and does not claim that LiftOrbit automatically validates ceramic recipes, kiln-loading geometry or product compatibility.</p>
<h2>Add materials and preparation</h2>
<p>Record starting material quantities and expected deliveries. Determine which operation consumes each material. A delivery on Thursday should not make an operation on Monday appear supplied. For glazing, define whether a product-family change occupies the workstation and for how long.</p>
<p>Use the ${link('/changeover-planning/','changeover example')} to see why grouping similar products can save preparation time while delaying another order. The objective is not simply the smallest number of changes: it is a plan you can execute with the priorities and constraints you chose.</p>
<h2>Evaluate the plan in LiftOrbit</h2>
<p>Use the ceramic demonstration as a learning environment, then model a small sample of your own process. Review the initial Gantt for operation order, resource occupation, setup blocks and material timing. Only after those are credible should you compare optimization results.</p>
<p>Change one assumption at a time. Add an order, change a processing duration or move a material delivery; rebuild the plan and check the resource affected by that change. Keep the previous input snapshot when recording a comparison so you know what the results refer to.</p>
<p>For an aggregate check of identical machines, use the ${link(calcPath,'production capacity calculator')}. It does not model a multi-stage ceramic route or shared kiln batches; the ${link('/production-capacity-planning/','capacity planning guide')} explains that boundary.</p>`}
];

export function calculateCapacity(v) {
  const rules = {machines:[1,10000,true],days:[1,366,true],shifts:[1,24,true],hours:[0.1,24,false],availability:[0.1,100,false],units:[0,10000000,true],cycle:[0.001,1000000,false],setups:[0,1000000,true],setupMinutes:[0,1000000,false]};
  for (const [key,[min,max,integer]] of Object.entries(rules)) {
    if(typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key]<min || v[key]>max || (integer && !Number.isInteger(v[key]))) throw new RangeError('Enter a valid value for '+key+'.');
  }
  if(v.shifts*v.hours>24) throw new RangeError('Shifts multiplied by hours per shift cannot exceed 24 hours per day.');
  const gross = v.machines*v.days*v.shifts*v.hours;
  const available = gross*v.availability/100;
  const processing = v.units*v.cycle/60;
  const setup = v.setups*v.setupMinutes/60;
  const required = processing+setup;
  const headroom = available-required;
  return {gross,available,processing,setup,required,headroom,load:required/available*100,maximumUnits:Math.max(0,Math.floor(((available-setup)*60)/v.cycle+1e-9))};
}

function initCalculator(calculate) {
  const form = document.getElementById('lo-capacity-form');
  if(!form) return;
  const output = document.getElementById('lo-results');
  const error = document.getElementById('lo-error');
  const inputs = Array.from(form.querySelectorAll('input'));
  const fmt = (n) => new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(n);
  function run(report=false) {
    inputs.forEach(el=>el.removeAttribute('aria-invalid'));
    error.textContent='';
    const invalid=inputs.find(el=>el.value.trim()==='' || !el.checkValidity());
    if(invalid) {
      invalid.setAttribute('aria-invalid','true');
      error.textContent='Check '+invalid.labels[0].textContent.trim().replace(/\s+/g,' ')+'. Enter a number within the shown range.';
      output.hidden=true;
      if(report) invalid.focus();
      return;
    }
    try {
      const values=Object.fromEntries(inputs.map(el=>[el.name,Number(el.value)]));
      const r=calculate(values);
      const put=(id,value)=>document.getElementById(id).textContent=value;
      output.hidden=false;
      put('lo-load',fmt(r.load)+'%'); put('lo-available',fmt(r.available)+' h'); put('lo-required',fmt(r.required)+' h');
      put('lo-headroom',fmt(Math.abs(r.headroom))+' h');
      put('lo-headroom-label',r.headroom<0?'Capacity shortfall':'Remaining capacity');
      put('lo-status',r.headroom<0?'Aggregate capacity is overloaded':'No aggregate overload in this estimate');
      put('lo-breakdown','Processing: '+fmt(r.processing)+' h. Setups: '+fmt(r.setup)+' h. Gross capacity before the availability allowance: '+fmt(r.gross)+' h.');
      put('lo-maximum',fmt(r.maximumUnits)+' units at the same cycle time and fixed setup count. This is an aggregate upper bound, not a promised output.');
      document.getElementById('lo-load-bar').style.width=Math.min(100,Math.max(0,r.load))+'%';
      output.dataset.overloaded=String(r.headroom<0);
    } catch(e) {
      output.hidden=true; error.textContent=e.message;
    }
  }
  form.addEventListener('submit',e=>{e.preventDefault();run(true);});
  form.addEventListener('input',()=>run());
  form.addEventListener('reset',()=>setTimeout(()=>run(),0));
  document.getElementById('lo-overload-example').addEventListener('click',()=>{form.reset();form.elements.namedItem('units').value='1400';run();});
  run();
}

const field=(name,label,value,min,max,step,help)=>`<div class="lo-field"><label for="lo-${name}">${label}</label><input id="lo-${name}" name="${name}" type="number" inputmode="decimal" value="${value}" min="${min}" max="${max}" step="${step}" required aria-describedby="lo-${name}-help"><small id="lo-${name}-help">${help}</small></div>`;
const calculator = {path:calcPath,type:'WebPage',tag:'FREE TOOL / NO SIGN-UP',title:'Production Capacity Calculator',description:'Calculate available machine hours, processing and setup demand, capacity load and overload. Free browser-based manufacturing capacity calculator with worked examples.',lead:'Does this week\'s workload fit? Compare machine hours with processing and setup demand before building a detailed schedule.',body:`
<div class="lo-calculator">
<form id="lo-capacity-form" novalidate>
<fieldset><legend>1. Available machine time</legend><div class="lo-fields">
${field('machines','Identical machines',2,1,10000,1,'1-10,000 interchangeable machines.')}
${field('days','Working days',5,1,366,1,'1-366 days in this planning window.')}
${field('shifts','Shifts per day',1,1,24,1,'Whole shifts; total hours/day must be 24 or less.')}
${field('hours','Hours per shift',8,0.1,24,'any','0.1-24 hours per shift.')}
${field('availability','Available time (%)',85,0.1,100,'any','0.1-100%. Exclude breaks/maintenance, not setups.')}
</div></fieldset>
<fieldset><legend>2. Work to be done</legend><div class="lo-fields">
${field('units','Units to produce',1000,0,10000000,1,'0-10,000,000 units at the same cycle time.')}
${field('cycle','Processing minutes per unit',3,0.001,1000000,'any','Positive machine time per unit; exclude setups.')}
${field('setups','Number of setups',10,0,1000000,1,'Whole setup events across all machines.')}
${field('setupMinutes','Minutes per setup',30,0,1000000,'any','Average occupied machine time per event.')}
</div></fieldset>
<p id="lo-error" role="alert" class="lo-error"></p>
<div class="lo-actions"><button class="lo-button" type="submit">Calculate capacity</button><button class="lo-button lo-secondary" type="reset">Reset example</button></div>
<button class="lo-text-button" id="lo-overload-example" type="button">Try an overloaded week: 1,400 units</button>
</form>
<section id="lo-results" class="lo-results" aria-labelledby="lo-result-title" aria-live="polite" hidden>
<p class="lo-kicker" id="lo-result-title">YOUR CAPACITY ESTIMATE</p><strong class="lo-load" id="lo-load"></strong><p>Planned load / available machine time</p>
<div class="lo-meter" aria-hidden="true"><span id="lo-load-bar"></span></div><p id="lo-status" class="lo-status"></p>
<dl class="lo-result-list"><div><dt>Available capacity</dt><dd id="lo-available"></dd></div><div><dt>Required capacity</dt><dd id="lo-required"></dd></div><div><dt id="lo-headroom-label">Remaining capacity</dt><dd id="lo-headroom"></dd></div></dl>
<p id="lo-breakdown" class="lo-small"></p><p class="lo-small"><strong>Capacity-based unit ceiling</strong><br><span id="lo-maximum"></span></p>
<p class="lo-small">This is not a feasible schedule or an OEE calculation. Timing, materials, people and process dependencies are not checked.</p>
</section></div>
<noscript><p class="lo-note">Enable JavaScript to use the calculator. The formulas and worked example below are available without JavaScript.</p></noscript>
<h2>How the calculation works</h2>
<p><strong>Gross hours</strong> = machines &times; working days &times; shifts per day &times; hours per shift.<br><strong>Available hours</strong> = gross hours &times; available-time percentage / 100.<br><strong>Required hours</strong> = units &times; processing minutes / 60 + setups &times; setup minutes / 60.<br><strong>Planned load</strong> = required hours / available hours &times; 100.</p>
<p>The default example has 80 gross hours, 68 available hours and 55 required hours: 50 for processing and five for setups. Planned load is 80.9%, leaving 13 hours. With 1,400 units and the same ten setups, required time becomes 75 hours: a seven-hour shortfall and 110.3% planned load.</p>
<h2>Assumptions and limits</h2>
<p>The calculator pools time across identical, interchangeable machines. Every machine uses the same calendar and availability allowance. All units use the same processing time, and setup count is fixed when estimating the unit ceiling. It does not handle batch firing, sequence-dependent setups, non-interchangeable machines, scrap rates, delivery dates or multi-stage routings.</p>
<p>Do not subtract setup time in the availability percentage and then add it again as setup demand. Do not treat an aggregate load below 100% as proof that each order can be delivered on time. For mixed resources, use one calculation per work centre and then inspect the complete schedule.</p>
<p><strong>Your entered values stay in this page.</strong> The calculator does not submit them to LiftOrbit, store them in a browser database or send them to an analytics service.</p>
<p>Continue with ${link('/production-capacity-planning/','production capacity planning')} or ${link('/changeover-planning/','machine changeover planning')} to turn this first estimate into better planning inputs.</p>`};
pages.push(calculator);

const css = `
.lo-page{margin:0;color:#14283a;background:#fff;font-family:Inter,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}.lo-page *,.lo-home *{box-sizing:border-box}.lo-page a{color:inherit}.lo-page a:focus-visible,.lo-page button:focus-visible,.lo-page input:focus-visible,.lo-home a:focus-visible{outline:3px solid #2a69df;outline-offset:4px}.lo-page p{line-height:1.75}.lo-wrap{width:min(1120px,calc(100% - 48px));margin:auto}.lo-header{border-bottom:1px solid #e1e7e8;background:#fff}.lo-nav{min-height:82px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}.lo-brand{font-size:24px;font-weight:800;letter-spacing:-1px;text-decoration:none;display:flex;align-items:center;gap:10px}.lo-brand img{width:33px;height:33px}.lo-navlinks{display:flex;align-items:center;gap:26px;font-size:14px;flex-wrap:wrap}.lo-navlinks a{text-decoration:none}.lo-navlinks a:hover{text-decoration:underline}.lo-button{display:inline-flex;justify-content:center;align-items:center;gap:8px;background:#2a69df;color:#fff!important;padding:14px 21px;border-radius:9px;border:1px solid transparent;font:650 14px/1.4 Inter,"Segoe UI",Arial,sans-serif;text-decoration:none!important;cursor:pointer;min-height:48px}.lo-button:hover{background:#185cd9}.lo-secondary{background:#fff;color:#14283a!important;border-color:#cbd6dd}.lo-secondary:hover{background:#eef3f6}.lo-hero{padding:38px 0 54px;background:#f6f8f6;border-bottom:1px solid #e1e7e8}.lo-breadcrumb{display:flex;gap:9px;flex-wrap:wrap;font-size:13px;color:#566c7c;margin-bottom:42px;line-height:1.6}.lo-breadcrumb a{text-decoration:none}.lo-breadcrumb a:hover{text-decoration:underline}.lo-kicker{font-size:11px!important;letter-spacing:.13em;font-weight:750;color:#427e71;margin:0 0 16px!important}.lo-page h1{font-size:clamp(34px,4.2vw,58px);line-height:1.12;letter-spacing:-.055em;max-width:880px;margin:0 0 22px;font-weight:800;text-wrap:balance}.lo-lead{font-size:19px;max-width:770px;color:#536978;margin:0 0 20px}.lo-meta{font-size:12px;color:#67778a;margin:0}.lo-content{padding-top:52px;padding-bottom:68px}.lo-prose{max-width:820px}.lo-prose:has(.lo-calculator){max-width:none}.lo-prose h2{font-size:28px;line-height:1.2;letter-spacing:-.035em;margin:38px 0 16px;text-wrap:balance}.lo-prose h2:first-child{margin-top:0}.lo-prose p{font-size:16px;color:#344e60;margin:0 0 20px}.lo-prose a:not(.lo-button),.lo-small a{color:#205abb;text-decoration:underline;text-underline-offset:3px}.lo-note{background:#edf5e6;border-left:4px solid #83b757;border-radius:0 10px 10px 0;padding:21px 24px;margin:28px 0;font-size:15px;line-height:1.7;color:#284837}.lo-note a{color:inherit!important}.lo-table-wrap{overflow-x:auto;border:1px solid #dde5e9;border-radius:12px;margin:24px 0}.lo-table-wrap table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;line-height:1.55;min-width:570px}.lo-table-wrap th{background:#f1f5f7;font-size:12px;color:#425d70}.lo-table-wrap th,.lo-table-wrap td{padding:15px 17px;vertical-align:top;border-bottom:1px solid #e1e7e8}.lo-table-wrap tr:last-child td{border-bottom:0}.lo-small{font-size:13px!important;line-height:1.65!important;color:#586e7d!important}.lo-cta{border-radius:18px;background:#14283a;color:#fff;padding:36px;margin-top:50px}.lo-cta h2{color:#fff;margin-top:0}.lo-cta p{color:#d6e1e6;max-width:620px}.lo-cta .lo-small{color:#d6e1e6!important;margin:18px 0 0}.lo-cta .lo-button{background:#c2ec83;color:#14283a!important}.lo-footer{padding:30px 0;border-top:1px solid #e1e7e8;color:#617585;font-size:13px}.lo-footer .lo-wrap{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.lo-footer a{text-decoration:none}.lo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.lo-card{display:flex;flex-direction:column;padding:28px;border:1px solid #dfe7e9;border-radius:16px;background:#fff;text-decoration:none!important}.lo-card:hover{border-color:#83a89b;background:#fbfcf9}.lo-card h2,.lo-card h3{font-size:25px;line-height:1.2;letter-spacing:-.035em;margin:0 0 14px;color:#14283a}.lo-card p{color:#586e7d;font-size:15px;margin:0 0 20px;line-height:1.7}.lo-card .lo-read{font-size:13px;font-weight:700;color:#205abb;margin-top:auto}.lo-card-featured{background:#edf5e6;grid-column:1/-1}.lo-home{padding:72px 0;background:#f6f8f6;border-top:1px solid #e1e7e8;font-family:Inter,"Segoe UI",Arial,sans-serif;color:#14283a}.lo-home h2{font-size:36px;line-height:1.15;letter-spacing:-.045em;margin:0 0 18px}.lo-home>div>p{max-width:720px;font-size:16px;color:#536978;margin-bottom:28px}.lo-home .lo-card h3{font-size:23px}.lo-home .lo-grid{margin-bottom:24px}.lo-calculator{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.9fr);gap:32px;align-items:start;margin:0 0 42px}.lo-calculator fieldset{border:0;padding:0;margin:0 0 24px;min-width:0}.lo-calculator legend{font-weight:750;font-size:18px;margin:0 0 20px;padding:0}.lo-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.lo-field label{display:block;font-size:13px;font-weight:650;margin-bottom:8px;line-height:1.4}.lo-field input{display:block;width:100%;height:46px;border:1px solid #bacbd4;border-radius:8px;background:#fff;font:500 17px Inter,"Segoe UI",Arial,sans-serif;color:#14283a;padding:8px 12px}.lo-field input[aria-invalid=true]{border:2px solid #b32828}.lo-field small{display:block;color:#617585;font-size:11px;line-height:1.5;margin-top:7px}.lo-actions{display:flex;gap:12px;flex-wrap:wrap}.lo-text-button{border:0;background:none;color:#205abb;cursor:pointer;font:500 13px/1.6 Inter,"Segoe UI",Arial,sans-serif;padding:14px 0;text-decoration:underline;text-underline-offset:3px;text-align:left}.lo-results{background:#f1f6ed;border:1px solid #d7e5cc;border-radius:16px;padding:28px;min-width:0}.lo-results[hidden]{display:none}.lo-results[data-overloaded=true]{background:#fff3e8;border-color:#e9cba7}.lo-load{font-size:56px;line-height:1.2;letter-spacing:-.05em;overflow-wrap:anywhere}.lo-results>p{font-size:13px;margin:12px 0}.lo-meter{height:8px;border-radius:5px;background:#dce5d5;overflow:hidden;margin:24px 0 16px}.lo-meter span{display:block;background:#578336;height:100%}.lo-results[data-overloaded=true] .lo-meter span{background:#b86920}.lo-status{font-weight:700}.lo-result-list{margin:24px 0}.lo-result-list>div{display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-top:1px solid #d6e1d0;font-size:13px;line-height:1.5}.lo-result-list dd{margin:0;font-weight:750;text-align:right;overflow-wrap:anywhere}.lo-error{color:#a42525!important;font-size:13px!important}.lo-error:empty{display:none}.lo-skip{position:absolute;top:-80px;left:16px;background:#14283a;color:#fff!important;padding:12px;z-index:99}.lo-skip:focus{top:10px}@media(max-width:760px){.lo-wrap{width:calc(100% - 36px)}.lo-nav{padding:18px 0;gap:16px}.lo-navlinks{gap:16px;font-size:12px}.lo-navlinks .lo-button{padding:10px 13px;font-size:12px;min-height:42px}.lo-hero{padding:28px 0 36px}.lo-breadcrumb{margin-bottom:28px;font-size:12px}.lo-lead{font-size:17px}.lo-grid,.lo-calculator{grid-template-columns:1fr}.lo-card{padding:23px}.lo-card-featured{grid-column:auto}.lo-content{padding-top:32px}.lo-prose h2{font-size:25px}.lo-calculator{gap:20px}.lo-cta{padding:25px}.lo-home{padding:48px 0}.lo-home h2{font-size:30px}.lo-note{padding:18px}.lo-load{font-size:48px}}@media(max-width:420px){.lo-brand{font-size:21px}.lo-navlinks{gap:12px}.lo-navlinks .lo-product-link{display:none}.lo-fields{gap:18px 14px}.lo-field label{font-size:12px}.lo-field input{font-size:16px}}@media(prefers-reduced-motion:reduce){.lo-page *{scroll-behavior:auto!important}}
`;

const card=(p,featured=false)=>`<a class="lo-card${featured?' lo-card-featured':''}" href="${p.path}"><span class="lo-kicker">${p.tag}</span><h2>${esc(p.title)}</h2><p>${esc(p.description)}</p><span class="lo-read">${p.path===calcPath?'Use the calculator':'Read the guide'} &rarr;</span></a>`;
const hub={path:'/resources/',type:'CollectionPage',tag:'LIFTORBIT RESOURCES',title:'Practical Production Planning Guides and Tools',description:'Free manufacturing planning resources: machine capacity calculator, changeover examples, spreadsheet planning checklist and a ceramic workshop scheduling guide.',lead:'Clear calculations. Explicit assumptions. Practical ways to turn orders and resource constraints into a plan you can check.',body:`<div class="lo-grid">${card(calculator,true)}${pages.filter(p=>p.path!==calcPath).map(p=>card(p)).join('')}</div>`};
pages.unshift(hub);

function renderPage(p) {
  const url=ORIGIN+p.path;
  const plannerHref="/go/planner?from="+encodeURIComponent(p.path);
  const breadcrumb=[{'@type':'ListItem',position:1,name:'Home',item:ORIGIN+'/'}];
  if(p.path!=='/resources/') breadcrumb.push({'@type':'ListItem',position:2,name:'Resources',item:ORIGIN+'/resources/'});
  breadcrumb.push({'@type':'ListItem',position:breadcrumb.length+1,name:p.title,item:url});
  const entity={'@type':p.type,'@id':url+'#page',url,name:p.title,description:p.description,inLanguage:'en',isPartOf:{'@id':ORIGIN+'/#website'}};
  if(p.type==='Article') Object.assign(entity,{headline:p.title,datePublished:DATE,dateModified:DATE,author:{'@type':'Organization',name:'LiftOrbit',url:ORIGIN+'/'},publisher:{'@id':ORIGIN+'/#organization'},mainEntityOfPage:url});
  const json=JSON.stringify({'@context':'https://schema.org','@graph':[entity,{'@type':'BreadcrumbList',itemListElement:breadcrumb}]}).replace(/</g,'\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f6f8f6"><title>${esc(p.title)} | LiftOrbit</title><meta name="description" content="${esc(p.description)}"><meta name="robots" content="index, follow, max-image-preview:large"><link rel="canonical" href="${url}"><meta property="og:type" content="${p.type==='Article'?'article':'website'}"><meta property="og:site_name" content="LiftOrbit"><meta property="og:title" content="${esc(p.title)} | LiftOrbit"><meta property="og:description" content="${esc(p.description)}"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(p.title)} | LiftOrbit"><meta name="twitter:description" content="${esc(p.description)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/growth.css?v=${RELEASE}"><script type="application/ld+json">${json}</script>${p.path===calcPath?`<script src="/capacity-calculator.js?v=${RELEASE}" defer></script>`:''}</head><body class="lo-page"><a class="lo-skip" href="#content">Skip to content</a><header class="lo-header"><div class="lo-wrap lo-nav"><a class="lo-brand" href="/" aria-label="LiftOrbit home"><img src="/favicon.svg" alt="" width="33" height="33">LiftOrbit</a><nav class="lo-navlinks" aria-label="Main navigation"><a class="lo-product-link" href="/#platform">Platform</a><a href="/resources/">Resources</a><a href="${calcPath}">Calculator</a><a class="lo-button" href="${plannerHref}" rel="nofollow">Open planner &rarr;</a></nav></div></header><main id="content"><section class="lo-hero"><div class="lo-wrap"><nav class="lo-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span>${p.path!=='/resources/'?'<a href="/resources/">Resources</a><span aria-hidden="true">/</span>':''}<span aria-current="page">${esc(p.title)}</span></nav><p class="lo-kicker">${p.tag}</p><h1>${esc(p.title)}</h1><p class="lo-lead">${esc(p.lead)}</p><p class="lo-meta">By LiftOrbit &middot; Updated 16 October 2026${p.type==='Article'?' &middot; Practical guide':''}</p></div></section><div class="lo-wrap lo-content"><article class="lo-prose${p.path==='/resources/'?' lo-hub':''}"${p.path==='/resources/'?' style="max-width:none"':''}>${p.body}</article><section class="lo-cta"><h2>Move from a capacity estimate to a production plan.</h2><p>Organise orders, machines, people, materials and changeovers in LiftOrbit, then inspect the sequence on a visual Gantt chart.</p><a class="lo-button" href="${plannerHref}" rel="nofollow">Explore the planner &rarr;</a><p class="lo-small">The application has registration. Automated 30-day trial timing and paid billing are not yet live. These resources and the calculator are free to use without an account.</p></section></div></main><footer class="lo-footer"><div class="lo-wrap"><span>&copy; 2026 LiftOrbit</span><a href="/resources/">All resources</a><a href="${calcPath}">Capacity calculator</a><a href="/#faq">Product FAQ</a></div></footer></body></html>`;
}

export const growthRoutes = new Map(pages.map(p=>[p.path,{body:renderPage(p),type:'text/html; charset=utf-8'}]));
growthRoutes.set('/growth.css',{body:css,type:'text/css; charset=utf-8'});
growthRoutes.set('/capacity-calculator.js',{body:`(${initCalculator.toString()})(${calculateCapacity.toString()});`,type:'application/javascript; charset=utf-8'});

export function enhanceHome(html) {
  if(!html.includes('</main>') || !html.includes('</head>')) throw new Error('Homepage structure changed: review resource links before release.');
  const section=`<section class="lo-home" aria-labelledby="lo-resources-title"><div class="lo-wrap"><p class="lo-kicker">FREE TOOLS &amp; PRACTICAL GUIDES</p><h2 id="lo-resources-title">Make your next production plan a better-informed one.</h2><p>Check machine capacity, understand changeovers and explore a ceramic workshop planning example. No account required.</p><div class="lo-grid"><a class="lo-card" href="${calcPath}"><span class="lo-kicker">FREE CALCULATOR</span><h3>Does the workload fit your machine time?</h3><p>Compare available hours with processing and setup demand, and spot aggregate overload.</p><span class="lo-read">Calculate capacity &rarr;</span></a><a class="lo-card" href="/resources/"><span class="lo-kicker">PLANNING RESOURCES</span><h3>Clear examples, not black-box promises.</h3><p>Practical guides to capacity, setup sequences, spreadsheets and ceramic production planning.</p><span class="lo-read">Explore all resources &rarr;</span></a></div></div></section>`;
  return html.replace('</head>',`<link rel="stylesheet" href="/growth.css?v=${RELEASE}"></head>`).replace('<a href="#faq">FAQ</a>','<a href="/resources/">Resources</a>').replace('</main>',section+'</main>');
}

export function enhanceSitemap(xml) {
  if(!xml.includes('</urlset>')) throw new Error('Unexpected sitemap format');
  const entries=pages.filter(p=>!xml.includes(`<loc>${ORIGIN+p.path}</loc>`)).map(p=>`  <url><loc>${ORIGIN+p.path}</loc><lastmod>${DATE}</lastmod></url>`).join('\n');
  return xml.replace(/<lastmod>2026-10-15<\/lastmod>/g,`<lastmod>${DATE}</lastmod>`).replace('</urlset>',(entries?entries+'\n':'')+'</urlset>');
}

export function enhanceLlms(text) {
  return text+'\n\n## Public planning resources\n'+pages.map(p=>`- [${p.title}](${ORIGIN+p.path}): ${p.description}`).join('\n')+'\n\nCalculator values stay in the browser. Worked examples are illustrative, not customer results. Automated 30-day trial timing and paid billing are not yet live.\n';
}
