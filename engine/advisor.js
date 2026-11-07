/*
 * Pool Equipment Advisor - sizing engine
 * ---------------------------------------------------------------
 * The calculation logic behind "Pool Equipment Advisor.html", with no
 * screen/DOM code. Runs unchanged in a browser (as a plain <script>)
 * or in Node (require/import), so it can be embedded in another app
 * or used as the reference implementation for a native rebuild.
 *
 *   const advisor = PoolAdvisor.createAdvisor(data);   // data = {pumps, swg, filters, rules, meta}
 *   const result  = advisor.recommend("pump", profile); // "pump" | "swg" | "filter" | "newpool"
 *
 * Every rule is documented in docs/RULES.md. Data fields: docs/DATA.md.
 * Expected behaviour is pinned by tests/cases/*.json (run: node tests/run.mjs).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PoolAdvisor = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

function createAdvisor(data) {
  if (!data || !data.pumps || !data.swg || !data.filters || !data.rules)
    throw new Error("createAdvisor: data must contain pumps, swg, filters and rules");
  const DATA = data;
  const RULES = data.rules;

  /* ---------------- shared helpers ---------------- */
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null;};
  const money=v=>v==null?'—':'$'+Math.round(v).toLocaleString();
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function curveIdx(profile){ // 0=A,1=B,2=C
    if(profile.poolType==='agp') return 0;
    if(profile.pipe==='2'||profile.pipe==='2.5+') return 2;
    return 0; // 1.5" and unknown -> A (conservative)
  }
  const FC_BY_CLIMATE=RULES.FC_DEMAND_DEFAULTS.value.byClimate;

  /* ---------------- PUMP ENGINE ---------------- */
  function pumpEngine(p){
    const ci=curveIdx(p);
    const FD=RULES.FEATURE_FLOW_DEMANDS.value;
    // Minimum everyday flow is set by the equipment that must actually work, not by
    // pool volume. Turnover does not determine minimum flow on a residential pool.
    const TF=RULES.TURNOVER_FORMULA.value;
    const minBits=[];
    let dailyGPM=TF.skimmerMinGpm; minBits.push('skimmer '+TF.skimmerMinGpm+' GPM');
    // Salt cell: the flow switch must close or the cell stops making chlorine. One source of
    // truth for the threshold: SWG_FLOW_SWITCH (tee size sets it, since the switch reads velocity).
    if(p.hasSWG){const t=(p.pipe==='1.5')?'1.5':'2'; const need=RULES.SWG_FLOW_SWITCH.value.byTee[t];
      if(need>dailyGPM){dailyGPM=need; minBits.length=0; minBits.push('salt cell flow switch '+need+' GPM');}}
    // A gas heater needs its minimum flow only while it is firing, so by default it is a peak
    // (feature) demand, not an all-day one (TURNOVER_FORMULA.heaterSetsDailyMinimum).
    if(p.gasHeater&&TF.heaterSetsDailyMinimum&&TF.gasHeaterMinGpm>dailyGPM){dailyGPM=TF.gasHeaterMinGpm; minBits.length=0; minBits.push('gas heater '+TF.gasHeaterMinGpm+' GPM');}
    let featureGPM=0; const featBits=[];
    if(p.spa){
      const jets=p.spaJets>0?p.spaJets:FD.defaultSpaJets;    // typical small spa if unspecified
      const spaGPM=jets*FD.spaJetGpmEach.typical;            // 10-25 GPM per jet; use typical
      featureGPM=Math.max(featureGPM,spaGPM);
      featBits.push(jets+' spa jet'+(jets===1?'':'s'));
    }
    if(p.waterfallWidth){const wf=p.waterfallWidth*FD.waterfallGpmPerInch;featureGPM=Math.max(featureGPM,wf);featBits.push('waterfall');}
    if(p.gasHeater){featureGPM=Math.max(featureGPM,FD.gasHeaterGpm.min);featBits.push('gas heater');}
    const requiredGPM=Math.max(dailyGPM,featureGPM);

    // filter flow cap
    const warnings=[];
    // Same allowable-flow basis as the filter engine: the filter's rated maximum is the hard
    // limit. For cartridges we only know area here, so use the catalog's typical rating per sq ft;
    // the stricter APSP-15 0.375 GPM/sq ft is an efficiency guideline, reported as info.
    const FC=RULES.FILTER_FLOW_CAP.value;
    let filterCap=null, filterGuide=null;
    if(p.filterType==='sand'&&p.filterSize){const r=(p.filterSize/2)/12;filterCap=Math.PI*r*r*FC.sandGpmPerSqFt;}
    else if(p.filterType==='cartridge'&&p.filterSize){filterCap=p.filterSize*FC.cartridgeTypicalRatedGpmPerSqFt;filterGuide=p.filterSize*FC.cartridgeGpmPerSqFt;}
    else if(p.filterType==='de'&&p.filterSize){filterCap=p.filterSize*FC.deGpmPerSqFt.max;}
    if(filterCap!=null&&requiredGPM>filterCap){
      warnings.push({code:'FILTER_FLOW_CAP',severity:'warning',ruleId:'FILTER_FLOW_CAP',
        text:`Required ~${Math.round(requiredGPM)} GPM exceeds what your filter is rated for (~${Math.round(filterCap)} GPM). A bigger filter is advised.`});
    } else if(filterGuide!=null&&requiredGPM>filterGuide){
      warnings.push({code:'FILTER_FLOW_GUIDELINE',severity:'info',ruleId:'FILTER_FLOW_CAP',
        text:`Peak flow of ~${Math.round(requiredGPM)} GPM is within your filter's rating but above the ~${Math.round(filterGuide)} GPM efficiency guideline (0.375 GPM per sq ft). That's fine for short spa or feature runs; keep everyday filtering at low speed.`});
    }

    const featureHours=featBits.length?FD.featureHoursPerDay:0;
    const dailyHours=Math.max(0,(p.runtime||RULES.DEFAULT_RUNTIME.value.hours)-featureHours);
    const cands=[];
    for(const pump of DATA.pumps){
      const reasons=[];
      // DOE: the specification is hydraulic horsepower, not THP. Use HHP where published;
      // fall back to the rough THP proxy only when HHP is missing.
      const DOE=RULES.VS_REQUIRED_ABOVE_THP.value;
      const overDoe = pump.hhp!=null ? (pump.hhp>=DOE.hhpThreshold)
                                     : (pump.thp!=null && pump.thp>DOE.thpApproxOnly);
      if(overDoe && pump.st!=='VS'){continue;}
      // New pool: TFP discourages single- and two-speed outright (unlike an existing-pool swap)
      if(p.newBuild && pump.st!=='VS'){continue;}
      const gLo=pump.lo.g[ci], wLo=pump.lo.w[ci], gHi=pump.hi.g[ci], wHi=pump.hi.w[ci];
      if(gHi==null||gHi<requiredGPM) continue; // can't reach peak/feature flow at all
      // Daily filtering runs at the minimum useful flow. VS pumps slow down to it; two- and
      // multi-speed pumps use their low speed if it delivers enough; single-speed runs flat out.
      const efficientLow = canRunAtDailyFlow(pump.st,gLo,dailyGPM);
      const wattsDaily = estWattsAtGPM(gLo,wLo,gHi,wHi,dailyGPM,pump.st);
      const kWh=(((wattsDaily||0)/1000)*dailyHours + ((wHi||0)/1000)*featureHours)*365;
      const annualCost=p.rate?kWh*p.rate:null;

      // automation
      let autoMatch=false;
      if(p.automation&&p.automation!=='none'){
        autoMatch = pump.brand.toLowerCase().includes(p.automation.toLowerCase());
        if(autoMatch) reasons.push({code:'AUTOMATION_SAME_BRAND',severity:'good',ruleId:'AUTOMATION_SAME_BRAND',text:`Same brand as your ${cap(p.automation)} automation — simplest to control.`});
        if(/superflo|supermax|whisperflo vst/i.test(pump.model)&&pump.st==='VS'){
          reasons.push({code:'AUTOMATION_SUPERFLO_NUANCE',severity:'warning',ruleId:'SUPERFLO_AUTOMATION',
            text:'Check the build date on this one. Units made after 11/20/2020 have RS-485 and talk to IntelliCenter, IntelliSync, EasyTouch and IntelliTouch; earlier ones need an external low-voltage relay for each speed. Either way its scheduler is limited \u2014 one start time with up to three speeds, where an IntelliFlo allows four independent schedules.'});
        }
      }
      if(pump.st==='VS') reasons.push({code:'VS_PREFERRED',severity:'good',ruleId:'VS_REQUIRED_ABOVE_THP',text:'Variable-speed — DOE-compliant and can run low, quiet and cheap for daily filtering.'});
      else if(pump.st!=='SS') reasons.push({code:'MULTISPEED',severity:'info',ruleId:'VS_REQUIRED_ABOVE_THP',text:`${pump.st==='DS'?'Two-speed':'Multi-speed'} — acceptable for an existing-pool swap, though VS saves more.`});
      reasons.push({code:'FLOW_MINIMUM', severity: efficientLow?'good':'info', ruleId:'TURNOVER_FORMULA',
        text: efficientLow?(pump.st==='VS'?`Can idle down to the ~${Math.round(dailyGPM)} GPM your ${minBits[0]} needs — cheapest way to run every day.`:`Low speed (~${Math.round(gLo)} GPM) covers the ~${Math.round(dailyGPM)} GPM your ${minBits[0]} needs, so it can run on low most of the day.`):(pump.st==='SS'?`Single speed: runs at full flow (~${Math.round(gHi)} GPM) all day even though ~${Math.round(dailyGPM)} GPM (${minBits[0]}) would do.`:`Reaches the ~${Math.round(dailyGPM)} GPM minimum (${minBits[0]}) only at a higher speed.`)});
      if(featBits.length) reasons.push({code:'FEATURE_FLOW',severity: gHi>=featureGPM?'good':'info',ruleId:'FEATURE_FLOW_DEMANDS',text:`Reaches ${featBits.join(' + ')} peak (~${Math.round(featureGPM)} GPM) at full speed.`});

      let score=0;
      score += 25;                              // reaches required flow (guaranteed)
      score += efficientLow?25:0;               // idles at turnover = big efficiency win
      score += pump.st==='VS'?14:(pump.st==='SS'?0:6);
      score += pump.wef?clamp(pump.wef,0,12)*2:0;
      if(annualCost!=null) score -= annualCost*0.05;
      score += autoMatch?12:0;
      score += pump.dq==='ok'?2:0;
      // New pool: TFP's default is a FULL-SIZE variable-speed pump (headroom for a spa, cleaner or
      // features added later, while still running slow and cheap day to day).
      if(p.newBuild){
        const NP=RULES.NEW_POOL_DEFAULTS.value;
        if(pump.thp!=null&&pump.thp>=NP.fullSizeMinThp){score+=NP.fullSizeBonus;
          reasons.push({code:'FULL_SIZE_VS',severity:'good',ruleId:'NEW_POOL_DEFAULTS',text:`Full-size variable-speed (${pump.thp} THP): TFP's default for a new pool. Headroom for a spa, cleaner or features later, and it still runs slow and cheap every day.`});}
        else reasons.push({code:'SMALLER_THAN_FULL_SIZE',severity:'info',ruleId:'NEW_POOL_DEFAULTS',text:`Smaller than a full-size pump (${pump.thp??'?'} THP). Fine for this pool as planned, but with less headroom if you add features later.`});
      }

      cands.push({product:pump, score, reasons,
        fit:{meetsCapacity:true,meetsFlow:true,meetsFlowLow:efficientLow,automationMatch:autoMatch,regulatoryOk:true},
        computed:{requiredGPM:round1(requiredGPM),dailyGPM:round1(dailyGPM),gpmAtCurveLow:gLo,gpmAtCurveHigh:gHi,wattsDaily:wattsDaily!=null?Math.round(wattsDaily):null,wattsHigh:wHi,annualKWh:kWh,annualCostUSD:annualCost?Math.round(annualCost):null}});
    }
    cands.sort((a,b)=>b.score-a.score);
    // Collapse identical-performance models AFTER ranking (scoring untouched).
    // Best-ranked model represents the group; every other name is kept and shown.
    const seenFP=new Map(); const collapsed=[];
    for(const cd of cands){
      const fp=pumpFingerprint(cd.product);
      if(seenFP.has(fp)){
        const rep0=seenFP.get(fp);
        (rep0.variants=rep0.variants||[]).push(pumpName(cd.product));
        continue;
      }
      cd.variants=[]; seenFP.set(fp,cd); collapsed.push(cd);
    }
    cands.length=0; cands.push(...collapsed);
    cands.forEach((c,i)=>c.rank=i+1);

    // Power: the catalog has no voltage field yet, so a 115V pad gets a check-before-you-buy note.
    if(p.voltage==='115') warnings.push({code:'VOLTAGE_115',severity:'warning',ruleId:'PUMP_VOLTAGE_CHECK',
      text:'Your pad is 115V. Many full-size variable-speed pumps are 230V only, so confirm the voltage on any pump below before buying. Some run on either voltage, and some deliver less power on 115V. Moving to 230V needs an electrician.'});
    else if(p.voltage==='unknown') warnings.push({code:'VOLTAGE_UNKNOWN',severity:'info',ruleId:'PUMP_VOLTAGE_CHECK',
      text:'Check the voltage at your equipment pad (115V or 230V) before buying: it must match the pump.'});
    // repair options
    const repairOptions=[];
    if(p.automationModel&&/aqualogic/i.test(p.automationModel))
      repairOptions.push({summary:'Hayward AquaLogic boards: a failed K1 relay (cold solder joint) or RTC capacitor is often a repair rather than a full replacement. Note: AquaLogic needs firmware ≥2.65 to run VS pumps and cannot be field-upgraded — that specific case needs a board swap.',ruleId:'AUTOMATION_EXCEPTIONS'});
    if(/ecostar/i.test(p.currentPump||''))
      repairOptions.push({ruleId:'ECOSTAR_KNOWN_ISSUE',summary:'Hayward EcoStar: the drive is separately replaceable from the motor, so a drive swap can be far cheaper than a whole pump — but note a replacement drive\u2019s warranty expires on the same date as the original pump. TFP considers these drives failure-prone and suggests the Hayward TriStar VS if you are replacing outright.'});

    // ---- salt cell flow switch: a VS pump run too slowly won't close it ----
    if(p.hasSWG && cands.length){
      const FS=RULES.SWG_FLOW_SWITCH.value.byTee;
      const teeKey = (p.pipe==='1.5')?'1.5':'2';
      const need = FS[teeKey];
      const top=cands[0];
      const lowFlow = top.computed.gpmAtCurveLow;
      if(lowFlow!=null && lowFlow<need){
        warnings.push({code:'SWG_FLOW_SWITCH',severity:'warning',ruleId:'SWG_FLOW_SWITCH',
          text:`Heads up on the salt cell: its flow switch trips on water velocity, so a ${teeKey}\u2033 tee needs roughly ${need} GPM. The top pick can idle near ${Math.round(lowFlow)} GPM, which is below that \u2014 set your lowest speed high enough to close the switch, or the cell will quietly stop making chlorine.`});
      } else if(lowFlow!=null){
        warnings.push({code:'SWG_FLOW_SWITCH_OK',severity:'info',ruleId:'SWG_FLOW_SWITCH',
          text:`Salt cell flow switch needs roughly ${need} GPM through a ${teeKey}\u2033 tee; this pump stays above that even at low speed.`});
      }
    }

    // ---- before/after energy vs the user's current pump (no product prices) ----
    let comparison=null;
    const curP = p.currentPumpId ? DATA.pumps.find(x=>x.id===p.currentPumpId) : null;
    if(curP && cands.length){
      const cgLo=curP.lo.g[ci], cwLo=curP.lo.w[ci], cgHi=curP.hi.g[ci], cwHi=curP.hi.w[ci];
      const cWattsDaily = estWattsAtGPM(cgLo,cwLo,cgHi,cwHi,dailyGPM,curP.st);
      const curKWh = (((cWattsDaily||0)/1000)*dailyHours + ((cwHi||0)/1000)*featureHours)*365;
      const top=cands[0];
      const newKWh = top.computed.annualKWh;
      if(curKWh>0 && newKWh!=null){
        const kWhSaved = curKWh-newKWh;
        const costSaved = p.rate? kWhSaved*p.rate : null;
        const pct = curKWh>0 ? (kWhSaved/curKWh)*100 : null;
        let paybackYears=null;
        if(p.quotedPrice>0 && costSaved>0) paybackYears = p.quotedPrice/costSaved;
        comparison={
          current:{model:pumpName(curP), st:curP.st, kWh:Math.round(curKWh),
                   cost:p.rate?Math.round(curKWh*p.rate):null, watts:Math.round(cWattsDaily||0)},
          recommended:{model:pumpName(top.product), st:top.product.st,
                   kWh:Math.round(newKWh), cost:top.computed.annualCostUSD, watts:top.computed.wattsDaily},
          kWhSaved:Math.round(kWhSaved), costSaved:costSaved!=null?Math.round(costSaved):null,
          pctSaved:pct!=null?Math.round(pct):null, paybackYears:paybackYears
        };
      }
    }
    return {mode:'pump',requiredGPM:round1(requiredGPM),dailyGPM:round1(dailyGPM),minDriver:minBits[0],featureGPM:round1(featureGPM),
      comparison,recommendations:cands.slice(0,12),warnings,repairOptions,curve:['A','B','C'][ci]};
  }

  /* ---------------- SWG ENGINE ---------------- */
  function swgEngine(p){
    const requiredLbs = 0.7 * (p.gallons/10000);
    // Daily chlorine demand: the owner's MEASURED daily FC loss (e.g. from PoolMath logs) beats the
    // regional default. Accepts ppm/day; ignored if missing or out of a sane range.
    const FD=RULES.FC_DEMAND_DEFAULTS.value;
    const measured = (typeof p.fcLossPpm==='number' && p.fcLossPpm>=FD.measuredRange[0] && p.fcLossPpm<=FD.measuredRange[1]) ? p.fcLossPpm : null;
    const ppm = measured ?? FC_BY_CLIMATE[p.climate] ?? FC_BY_CLIMATE.warm ?? 3;
    const ppmSource = measured!=null ? 'measured' : 'climate';
    const lbsNeeded = p.gallons * ppm * FD.lbsPerPpmPerGallon; // daily FC demand in lbs Cl2
    const runtime = p.runtime||RULES.DEFAULT_RUNTIME.value.hours;
    const warnings=[];
    if(p.newPlaster) warnings.push({code:'NEW_PLASTER_NO_SALT',severity:'blocker',ruleId:'NEW_PLASTER_NO_SALT',text:'New plaster: do NOT add salt or run an SWG until the plaster has cured ~30 days. Use liquid chlorine until then.'});
    if(p.poolType==='agp'&&!p.bonding) warnings.push({code:'BONDING_CHECK',severity:'info',ruleId:'AGP_BONDING_CHECK',text:'Above-ground: confirm equipment bonding and water bond per NEC / local code before install.'});

    const seen=new Set(); const cands=[]; let anyDerate=false;
    for(const s of DATA.swg){
      // de-dup obvious hardware families for display
      const fkey=s.fam||s.id;
      const reasons=[];
      const flagged = (s.dq==='conflicting-sources'||s.dq==='advertised-output-disputed');
      const derate = RULES.SWG_OUTPUT_HAIRCUT.value.defaultDeratingFactor; // 1 — published output used as-is
      if(flagged) anyDerate=true;
      const effLbs = s.lbs*derate;
      const meetsCapacity = effLbs>=requiredLbs;
      const secondary = s.rated!=null ? (s.rated>=2*p.gallons) : null;
      const reqPct = effLbs>0 ? (lbsNeeded/(effLbs*(runtime/24)))*100 : 999;
      const over100 = reqPct>100;
      const warnPct = RULES.SWG_MAX_OUTPUT_PCT.value.warnAbovePct; // 50 — scale control
      const highOut = reqPct>warnPct && reqPct<=100;

      if(flagged) reasons.push({code:'DATA_QUALITY_FLAG',severity:'info',ruleId:'SWG_OUTPUT_HAIRCUT',text:`Published output for this model is disputed between sources. Measurement generally matches published figures, so it is used as-is — but verify against the manufacturer before buying.`});
      reasons.push({code:'CAPACITY',severity:meetsCapacity?'good':'blocker',ruleId:'SWG_2X_RULE',
        text:meetsCapacity?`Meets the ≥2× rule: ${round2(effLbs)} lbs/day vs ${round2(requiredLbs)} needed.`:`Undersized: ${round2(effLbs)} lbs/day below the ${round2(requiredLbs)} needed.`});
      if(secondary===true) reasons.push({code:'RATED_GALLONS',severity:'good',ruleId:'SWG_2X_RULE',text:`Rated for ${s.rated.toLocaleString()} gal ≥ 2× your pool.`});
      reasons.push({code:'REQ_OUTPUT',severity:over100?'warning':(highOut?'warning':'info'),ruleId:'SWG_MAX_OUTPUT_PCT',
        text:over100?`Would need >100% output at ${runtime}h/day — run the pump longer or size up.`:`Needs ~${Math.round(reqPct)}% output at ${runtime}h/day${highOut?' — above about '+warnPct+'%, so longer off periods would help keep scale down.':'.'}`});

      // cycle compatibility
      if(p.cycle==='short'){
        if(s.ctrl==='duty-cycle') reasons.push({code:'CYCLE_DUTY',severity:'warning',ruleId:'SWG_2X_RULE',text:'Long duty-cycle unit with short pump runs — may not complete a cycle. A proportional unit suits short cycles better.'});
        else if(s.ctrl==='proportional') reasons.push({code:'CYCLE_PROP',severity:'good',ruleId:'SWG_2X_RULE',text:'Proportional output — well suited to short pump cycles.'});
        else if(s.ctrl==null) reasons.push({code:'CYCLE_UNKNOWN',severity:'info',ruleId:'SWG_2X_RULE',text:'Cycle behavior not documented for this model.'});
      }
      // cold climate
      if(p.climate==='cool_temperate'&&s.ltCut!=null) reasons.push({code:'LOW_TEMP',severity:'info',ruleId:'SWG_2X_RULE',text:`Output tapers below ~${s.ltRed??s.ltCut}°F, cuts off ~${s.ltCut}°F.`});
      if(s.notes&&s.notes.some(n=>/low-temp|sticky/i.test(n))) reasons.push({code:'LOW_TEMP_NOTE',severity:'info',ruleId:'SWG_2X_RULE',text:'Known sticky low-temp behavior — check winter operation.'});
      // automation
      let autoMatch=false;
      if(p.automation&&p.automation!=='none'){
        autoMatch=s.auto&&s.auto.some(a=>a.toLowerCase().includes(p.automation.toLowerCase()));
        if(autoMatch) reasons.push({code:'AUTOMATION_SAME_BRAND',severity:'good',ruleId:'AUTOMATION_SAME_BRAND',text:`Controllable by your ${cap(p.automation)} automation.`});
        if(s.auto&&s.auto.some(a=>/al-5/i.test(a))&&/jandy/i.test(p.automation)) reasons.push({code:'AL5',severity:'info',ruleId:'AUTOMATION_EXCEPTIONS',text:'Set AquaRite to AL-5 for Jandy AquaLink control.'});
      }
      if(p.highCH&&s.polH) reasons.push({code:'POLARITY',severity:'info',ruleId:'SWG_POLARITY_HIGH_CH',text:`High CH: ~${s.polH}h polarity-reversal interval helps limit scaling.`});

      let score=0;
      score += meetsCapacity?50:-40;                       // 2x lbs/day rule is primary
      // Reward capacity up to what the pool needs. For cells that DO meet the rule this is a
      // constant, so headroom below still decides; for a pool too big for any single cell it
      // ranks the closest (largest) cells first instead of leaving them all tied.
      score += Math.min(effLbs,requiredLbs)*8;
      score += clamp(effLbs-requiredLbs,0,3)*6;            // capped headroom bonus
      score -= over100?15:(highOut?6:0);                   // runtime advice, not a veto
      score += secondary===true?8:0;
      if(p.cycle==='short'){score += s.ctrl==='proportional'?12:(s.ctrl==='duty-cycle'?-10:0);}
      score += autoMatch?12:0;
      score += s.dq==='verified'?6:(s.dq==='base-only'?0:2);
      score -= flagged?2:0;

      cands.push({product:s,fkey,score,reasons,derated:flagged,effLbs:round2(effLbs),
        fit:{meetsCapacity,automationMatch:autoMatch,regulatoryOk:meetsCapacity,secondary},
        computed:{requiredLbs:round2(requiredLbs),deratedLbsPerDay:round2(effLbs),requiredOutputPct:Math.round(reqPct),lbsNeeded:round3(lbsNeeded),estRuntimeHours:runtime,ratedPoolGallons:s.rated}});
    }
    // rank, then dedup by family keeping best
    cands.sort((a,b)=>b.score-a.score);
    const out=[]; const fseen=new Set();
    for(const c of cands){ if(fseen.has(c.fkey))continue; fseen.add(c.fkey); out.push(c); }
    out.forEach((c,i)=>c.rank=i+1);
    if(anyDerate) warnings.push({code:'DATA_QUALITY_FLAG',severity:'info',ruleId:'SWG_OUTPUT_HAIRCUT',text:'Some models have disputed published output (badged below). Measured output generally matches published figures, so no derating is applied — but confirm with the manufacturer.'});

    const anyMeets = out.some(c=>c.fit.meetsCapacity);
    if(!anyMeets) warnings.push({code:'MULTI_CELL',severity:'warning',ruleId:'SWG_2X_RULE',text:'No single cell meets the ≥2× rule for this pool — consider multiple cells or consult the forum.'});
    else if(out[0]&&out[0].computed.requiredOutputPct>100) warnings.push({code:'RUNTIME_LOW',severity:'info',ruleId:'SWG_MAX_OUTPUT_PCT',text:`At ${runtime}h/day even the top pick runs past 100% output — plan on a longer pump schedule.`});
    // Flow switch: velocity-based, so tee size sets the threshold.
    {const FS=RULES.SWG_FLOW_SWITCH.value.byTee; const teeKey=(p.pipe==='1.5')?'1.5':'2';
     warnings.push({code:'SWG_FLOW_SWITCH',severity:'info',ruleId:'SWG_FLOW_SWITCH',
       text:`If you run a variable-speed pump, keep the lowest speed above roughly ${FS[teeKey]} GPM (${teeKey}\u2033 tee). The flow switch reacts to water velocity, so too slow a speed stops chlorine production without any obvious fault.`});}
    // AquaRite-family panels infer salinity from the cell, so the cell-type setting must match.
    // Only use the "changing cells" wording when the SAME panel family is being reused.
    if(out[0]){
      const famOf=x=>/aqua ?rite/i.test(x.mfr+' '+x.model)?'aquarite':(/circupool/i.test(x.mfr)?'circupool':null);
      const recFam=famOf(out[0].product);
      if(recFam){
        const curP = p.currentSwgId ? DATA.swg.find(x=>x.id===p.currentSwgId) : null;
        const sameFamily = curP && famOf(curP)===recFam;
        const swappingCell = sameFamily && curP.cell && out[0].product.cell && curP.cell!==out[0].product.cell;
        const setting = recFam==='aquarite' ? 'T-Cell type setting' : 'cell-type setting';
        warnings.push({code:'AQUARITE_CELL_TYPE',severity:swappingCell?'warning':'info',ruleId:'AQUARITE_CELL_TYPE',
          text:(swappingCell
            ? `Important on install: this panel works out salt from the cell itself, so going from ${curP.cell} to ${out[0].product.cell} means you must change the ${setting} to match. Leave it wrong and salt reads wrong \u2014 which can trip a check-salt warning and stop chlorine production.`
            : `On install, set the ${setting} to match the cell you actually fit \u2014 this panel works out salt from cell performance rather than a salt sensor, so a mismatch makes salt read wrong and can stop chlorine production. Confirm real salt with a K-1766 drop test rather than trusting the display.`)});
      }
    }
    // Cells with no percentage control: output % is meaningless.
    if(out[0]&&/intex/i.test(out[0].product.mfr)){
      warnings.push({code:'SWG_ONOFF_ONLY',severity:'info',ruleId:'SWG_ONOFF_ONLY',
        text:'This cell has no output percentage \u2014 it runs at 100% or off, so you control chlorine purely with pump run time.'});
    }
    // CYA is the cheapest way to make the cell work less hard.
    if(out[0]){const CY=RULES.SWG_CYA_CELL_LIFE.value;
      warnings.push({code:'SWG_CYA_CELL_LIFE',severity:'info',ruleId:'SWG_CYA_CELL_LIFE',
        text:`Hold CYA at ${CY.cyaTarget[0]}\u2013${CY.cyaTarget[1]} once you are running on salt. Higher CYA shields chlorine from sunlight, so the cell makes less to hold the same FC and lasts longer. Note the output percentage is a share of pump run time \u2014 change your schedule and you will need to re-tune it.`});}
    // Cell life context: a cell that loafs along lasts far longer than one pinned near 100%.
    if(out[0]){const CL=RULES.CELL_LIFE.value, pct=out[0].computed.requiredOutputPct;
      warnings.push({code:'CELL_LIFE',severity:'info',ruleId:'CELL_LIFE',
        text:`Cell life is measured in generating hours \u2014 roughly ${CL.oemHours.toLocaleString()} for OEM cells, nearer ${CL.typicalGenericHours.toLocaleString()} for generics (some offshore cells as low as ${CL.poorOffshoreHours.toLocaleString()}). At about ${pct}% output the top pick spends most of the day idle, which is exactly why TFP says to oversize.`});}
    // Longer runtime is usually cheaper than a bigger cell, and is easier on the cell.
    if(out[0]&&out[0].computed.requiredOutputPct>RULES.SWG_MAX_OUTPUT_PCT.value.warnAbovePct){
      const need=out[0].computed.requiredOutputPct, cur=runtime;
      const tgt=RULES.SWG_RUNTIME_TRADEOFF.value.targetPct;
      const hrs=Math.min(24,Math.ceil((need/tgt)*cur));  // hours that would bring it to ~target %
      if(hrs>cur) warnings.push({code:'SWG_RUNTIME_TRADEOFF',severity:'info',ruleId:'SWG_RUNTIME_TRADEOFF',
        text:`Top pick needs about ${need}% output at ${cur}h/day. Running the pump roughly ${hrs}h/day at low RPM would drop it to about ${tgt}% — usually cheaper than buying a larger cell, keeps scale down, and the cell lasts longer when it works less hard.`});
    }

    const repairOptions=[];
    if(p.failure==='board-dead') repairOptions.push({summary:'A dead SWG control board is sometimes a repairable RTC-capacitor or relay fault rather than a full replacement — worth a diagnosis before buying new.',ruleId:'AUTOMATION_EXCEPTIONS'});
    if(p.failure==='cell-eol') repairOptions.push({summary:'If only the cell is at end-of-life, a replacement cell for your existing control box is usually far cheaper than a whole new system.',ruleId:'SWG_2X_RULE'});

    // ---- before/after vs the user's current cell (capacity + how hard it must work) ----
    let comparison=null;
    const curS = p.currentSwgId ? DATA.swg.find(x=>x.id===p.currentSwgId) : null;
    if(curS && out.length){
      // Same output basis as the rankings, so the before/after is apples to apples.
      const curDerate=RULES.SWG_OUTPUT_HAIRCUT.value.defaultDeratingFactor;
      const curEff=curS.lbs*curDerate;
      const curPct = curEff>0 ? (lbsNeeded/(curEff*(runtime/24)))*100 : 999;
      const top=out[0];
      comparison={
        current:{model:curS.mfr+' '+curS.model, lbs:round2(curEff), pct:Math.round(curPct),
                 rated:curS.rated, meets:curEff>=requiredLbs},
        recommended:{model:top.product.mfr+' '+top.product.model, lbs:top.effLbs,
                 pct:top.computed.requiredOutputPct, rated:top.product.rated, meets:top.fit.meetsCapacity},
        capacityFactor: curEff>0 ? Math.round((top.effLbs/curEff)*100)/100 : null,
        pctDrop: (curPct<900&&top.computed.requiredOutputPct!=null) ? Math.round(curPct-top.computed.requiredOutputPct) : null
      };
    }
    if(measured!=null) warnings.push({code:'FC_LOSS_MEASURED',severity:'good',ruleId:'FC_DEMAND_DEFAULTS',
      text:`Using your measured chlorine loss of ${measured} ppm/day instead of the regional default, so output percentages reflect your pool.`});
    else warnings.push({code:'FC_LOSS_ESTIMATED',severity:'info',ruleId:'FC_DEMAND_DEFAULTS',
      text:`Chlorine demand is estimated at ${ppm} ppm/day for your climate. If you track your daily FC loss (an overnight FC loss test, or your PoolMath logs), entering it makes the output percentages specific to your pool.`});
    return {mode:'swg',requiredLbs:round2(requiredLbs),lbsNeeded:round3(lbsNeeded),ppm,ppmSource,runtime,
      comparison,recommendations:out.slice(0,12),warnings,repairOptions};
  }

  const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
  const round1=x=>x==null?null:Math.round(x*10)/10;
  const round2=x=>x==null?null:Math.round(x*100)/100;
  const round3=x=>x==null?null:Math.round(x*1000)/1000;
  // Estimate the watts a pump draws while delivering `target` GPM on one CEC system curve
  // (rule PUMP_ENERGY_MODEL).
  //  - Single-speed: always its one (high) point.
  //  - Two-/multi-speed: fixed speeds, no throttling. Low speed if it delivers the target,
  //    otherwise high speed.
  //  - Variable-speed: on a fixed system curve the hydraulic power follows flow^3 (affinity
  //    laws), plus a roughly constant drive/motor loss. Fit watts = fixed + k*flow^3 through
  //    BOTH CEC test points. (The old model scaled the low point alone with flow^3, which
  //    ignored the fixed losses and made pumps tested at a higher low-speed flow look
  //    unrealistically cheap at very low flow.)
  function estWattsAtGPM(gLo,wLo,gHi,wHi,target,st){
    if(gHi==null||wHi==null) return null;
    if(st==='SS') return wHi;
    if(target>=gHi) return wHi;
    const hasLo = gLo!=null&&wLo!=null&&gLo>0;
    if(st==='DS'||st==='MS') return (hasLo&&gLo>=target)?wLo:wHi;
    if(!hasLo) return wHi;
    const EM=RULES.PUMP_ENERGY_MODEL.value;
    if(EM.vsModel==='twoPointFit' && gHi>gLo){
      const k=(wHi-wLo)/(Math.pow(gHi,3)-Math.pow(gLo,3));
      const fixed=wLo-k*Math.pow(gLo,3);
      if(k>0&&fixed>=0) return Math.min(Math.max(fixed+k*Math.pow(target,3),0),wHi);
    }
    // fallback (and the previous model): cube law anchored on the low point
    return Math.min(Math.max(wLo*Math.pow(target/gLo,3),0),wHi);
  }
  // Can this pump run at (or near) the daily minimum flow, rather than well above it?
  function canRunAtDailyFlow(st,gLo,dailyGPM){
    if(gLo==null) return false;
    if(st==='VS') return gLo<=dailyGPM+2;              // VS can slow down to it
    if(st==='DS'||st==='MS') return gLo>=dailyGPM && gLo<=dailyGPM*RULES.PUMP_ENERGY_MODEL.value.fixedSpeedLowMaxOverMinimum; // low speed meets it without big overshoot
    return false;
  }
  /* Identity fingerprint: EVERY measured field, full precision. Two pumps group
     only if all of these match exactly — any difference keeps them separate.
     Nothing is removed from the catalog or the search picker; grouping only
     affects display, and every variant name is shown on the card. */
  function pumpFingerprint(x){
    return [x.st,x.mot,x.thp,x.nhp,x.wef,x.frame,
      x.hi.rpm,(x.hi.g||[]).join('/'),(x.hi.w||[]).join('/'),
      x.lo.rpm,(x.lo.g||[]).join('/'),(x.lo.w||[]).join('/')].join('|');
  }
  const pumpName=x=>{const m=stripBrand(x.model,x.brand);return m.toLowerCase().startsWith(x.brand.toLowerCase())?m:(x.brand+' '+m);};
  const stripBrand=(model,brand)=>model.replace(new RegExp('^'+brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'').trim()||model;

  /* ---------------- FILTER ENGINE ---------------- */
  function filterMinRequired(type,p){
    const FS=RULES.FILTER_SIZING.value;
    if(type==='cartridge') return {kind:'sqft',value:Math.round(FS.cartridgeMinSquareFeetPer10k*p.gallons/10000),
      target:Math.round(FS.cartridgeSquareFeetPer10k*p.gallons/10000),ruleId:'FILTER_SIZING'};
    if(type==='de') return {kind:'sqft',value:(p.gallons>25000?FS.deSquareFeet.min_if_over_25k:FS.deSquareFeet.min),ruleId:'FILTER_SIZING'};
    if(type==='hybrid-de') return {kind:'sqft',value:(p.gallons>25000?FS.hybridDeSquareFeet.larger:FS.hybridDeSquareFeet.min),ruleId:'FILTER_SIZING'};
    const d=(p.gallons>25000||p.debris==='high')?FS.sandInches.min_if_over_25k_or_high_debris:FS.sandInches.min;
    return {kind:'diam',value:d,ruleId:'FILTER_SIZING'};
  }
  function bedAreaOf(f){ return f.bed!=null?f.bed:(f.tank!=null?Math.PI*Math.pow(f.tank/2/12,2):null); }
  function filterAllowGPM(f){ return f.ft==='sand'?(bedAreaOf(f)!=null?RULES.FILTER_FLOW_CAP.value.sandGpmPerSqFt*bedAreaOf(f):null):f.gpm; }
  function recommendFilterType(p){
    if(p.waterCost==='high') return {type:'cartridge',reasons:[{code:'FILTER_TYPE_CARTRIDGE_WATER',severity:'good',ruleId:'FILTER_TYPE_RECOMMENDATION',text:'Cartridge chosen: no backwashing, least water waste.'}]};
    if(p.clarity) return {type:'de',reasons:[{code:'FILTER_TYPE_DE_CLARITY',severity:'good',ruleId:'FILTER_TYPE_RECOMMENDATION',text:'DE chosen for finest clarity (~3–5 micron vs ~10 cartridge, ~30 sand).'}]};
    // New builds follow TFP's stated new-pool default (oversized cartridge) even with heavy debris —
    // extra cartridge area handles debris without the backwash water a sand filter costs.
    if(p.newBuild&&p.debris==='high') return {type:'cartridge',reasons:[
      {code:'FILTER_TYPE_DEFAULT_CARTRIDGE',severity:'good',ruleId:'NEW_POOL_DEFAULTS',text:'Cartridge chosen — TFP’s general recommendation for a new pool.'},
      {code:'FILTER_TYPE_DEBRIS',severity:'info',ruleId:'FILTER_TYPE_RECOMMENDATION',text:'Heavy debris: we size the cartridge up rather than switching to sand, so you avoid backwash water. A large sand filter is a reasonable alternative if you prefer simpler cleaning.'}]};
    if(p.debris==='high') return {type:'sand',reasons:[{code:'FILTER_TYPE_DEBRIS',severity:'good',ruleId:'FILTER_TYPE_RECOMMENDATION',text:'Sand chosen: low-maintenance for heavy debris (cartridge also viable if space allows).'}]};
    return {type:'cartridge',reasons:[{code:'FILTER_TYPE_DEFAULT_CARTRIDGE',severity:'good',ruleId:'FILTER_TYPE_RECOMMENDATION',text:'Cartridge is TFP’s general-purpose pick: good clarity, no backwash, pairs well with VS pumps.'}]};
  }
  function filterEngine(p){
    const W=RULES.FILTER_RANKING_WEIGHTS.value;
    const warnings=[]; let chosenType=p.desiredType, typeReasons=[];
    if(p.desiredType==='recommend'){ const t=recommendFilterType(p); chosenType=t.type; typeReasons=t.reasons; }
    const min=filterMinRequired(chosenType,p);
    const pumpMaxGPM=p.pumpMaxGPM||null;
    const cands=[], disq=[];
    for(const f of DATA.filters){
      if(f.ft!==chosenType) continue;
      const reasons=[]; let blocker=null;
      const size=f.ft==='sand'?f.tank:f.area;
      const meetsMin = size!=null && size>=min.value;
      if(!meetsMin) blocker={code:'FILTER_UNDERSIZED',severity:'blocker',ruleId:'FILTER_SIZING',text:`Below the ${min.value}${min.kind==='diam'?'″':' sq ft'} minimum (this is ${size??'?'}${min.kind==='diam'?'″':' sq ft'}).`};
      const allow=filterAllowGPM(f);
      let flowOk=true;
      if(!blocker && pumpMaxGPM!=null && allow!=null && allow<pumpMaxGPM){ flowOk=false; blocker={code:'FILTER_FLOW_BOTTLENECK',severity:'blocker',ruleId:'FILTER_MUST_NOT_BOTTLENECK_PUMP',text:`Allows only ~${Math.round(allow)} GPM but your pump pushes ~${pumpMaxGPM} GPM — it would choke the flow.`}; }
      if(blocker){ disq.push({product:f,reason:blocker}); continue; }
      let portOk=true;
      if(p.pipeIn!=null && f.port!=null && f.port<p.pipeIn){ portOk=false; reasons.push({code:'FILTER_PORT_UNDERSIZED',severity:'warning',ruleId:'FILTER_MUST_NOT_BOTTLENECK_PUMP',text:`Ports are ${f.port}″ vs your ${p.pipeIn}″ plumbing — a reducer adds some restriction.`}); }
      const minBed = min.kind==='diam'?Math.PI*Math.pow(min.value/2/12,2):null;
      const oversize = min.kind==='diam' ? (bedAreaOf(f)/minBed) : (f.area/min.value);
      reasons.push({code:'FILTER_SIZE_OK',severity:'good',ruleId:'FILTER_SIZING',text:`${min.kind==='diam'?f.tank+'″ tank':f.area+' sq ft'} — ${oversize>=1.5?'comfortably above':'meets'} the ${min.value}${min.kind==='diam'?'″':' sq ft'} minimum.`});
      if(oversize>=1.5) reasons.push({code:'FILTER_BIGGER_IS_BETTER',severity:'good',ruleId:'FILTER_BIGGER_IS_BETTER',text:`~${oversize.toFixed(1)}× minimum → longer runs between cleanings.`});
      if(pumpMaxGPM!=null&&allow!=null) reasons.push({code:'FILTER_FLOW_OK',severity:'good',ruleId:'FILTER_MUST_NOT_BOTTLENECK_PUMP',text:`Handles ~${Math.round(allow)} GPM ≥ your pump's ~${pumpMaxGPM} GPM.`});
      reasons.push({code:'FILTER_TURNOVER_NOT_A_FACTOR',severity:'info',ruleId:'FILTER_TURNOVER_NOT_A_FACTOR',text:'Sized for dirt-holding + low cleaning frequency, not turnover.'});
      if(f.cart) reasons.push({code:'CART_ELEMENT',severity:'info',ruleId:'FILTER_REPAIR_FACTS',text:`Replacement element: ${f.cart}.`});
      const dq = f.dq==='verified'?1:0.4;
      // Flow is a pass/fail gate; beyond passing, a comfortable margin has capped value.
      const flowComfort = (pumpMaxGPM!=null&&allow!=null)?clamp((allow-pumpMaxGPM)/pumpMaxGPM,0,0.3)/0.3:0.6;
      // Sweet spot = the SMALLEST model that clears both gates with a little
      // dirt-holding headroom (cost/footprint efficient). Bigger models are surfaced
      // as explicit size-up alternatives — that's where FILTER_BIGGER_IS_BETTER applies.
      let score=100;
      score -= (p.newBuild?12:25)*clamp(oversize-1,0,2);   // new builds tolerate more headroom
      // Cartridge filters CAN be oversized — beyond ~200 sq ft per 10,000 gal you are paying
      // for area you will never use. Sand and DE do not have this problem.
      if(chosenType==='cartridge' && min.target && size>min.target){
        const over=(size-min.target)/min.target;
        score -= 30*clamp(over,0,1);
        reasons.push({code:'FILTER_OVER_TARGET',severity:'info',ruleId:'FILTER_SIZING',
          text:`Above the ~${min.target} sq ft that suits ${Number(p.gallons).toLocaleString()} gallons. Extra cartridge area past this point buys very little — a smaller unit would still go a full season between cleanings.`});
      }
      score -= oversize<1.05?6:0;          // but avoid the razor-thin exact-minimum
      score += (W.flowHeadroom/2)*flowComfort; // capped flow-margin comfort (medium weight)
      score += W.dataQuality*dq;           // verified over partial
      score -= portOk?0:5;
      cands.push({product:f,score,reasons,fit:{meetsMinSize:true,flowOk,portOk,withinBudget:true},derated:false,
        computed:{minRequired:min.value,candidateSize:size,candidateMaxGPM:allow!=null?Math.round(allow):null,pumpMaxGPM,oversizeRatio:Math.round(oversize*100)/100}});
    }
    cands.sort((a,b)=> (b.score-a.score) || ((a.computed.candidateSize||0)-(b.computed.candidateSize||0)) );
    cands.forEach((c,i)=>c.rank=i+1);
    const alternatives=[];
    if(cands.length>1){
      const top=cands[0];
      const ceiling = (chosenType==='cartridge'&&min.target)?min.target:Infinity;
      const bigger=cands.slice(1).filter(c=>(c.computed.candidateSize||0)>(top.computed.candidateSize||0)
          && (c.computed.candidateSize||0)<=ceiling)
        .sort((a,b)=>(a.computed.candidateSize||0)-(b.computed.candidateSize||0))[0];
      if(bigger){ bigger.sizeUp=true; alternatives.push({product:bigger.product,label:'size-up'}); }
    }
    if(cands[0]&&cands[0].product.dq!=='verified') warnings.push({code:'FILTER_DATA_UNVERIFIED',severity:'warning',ruleId:'FILTER_RANKING_WEIGHTS',text:'Top pick has a partially-verified spec — confirm dimensions before buying.'});
    warnings.push({code:'FILTER_AUTOMATION_AGNOSTIC',severity:'info',ruleId:'AUTOMATION_SAME_BRAND',text:'Filters aren’t controlled by automation, so brand match doesn’t matter here.'});
    if(!cands.length) warnings.push({code:'NO_FILTER',severity:'warning',ruleId:'FILTER_MUST_NOT_BOTTLENECK_PUMP',text:`No ${chosenType} filter cleared both the size minimum and your pump flow — try a larger type or re-check the pump flow.`});
    const repairOptions=[]; const RF=RULES.FILTER_REPAIR_FACTS.value; const fm=p.failureMode, rt=p.replacingType;
    if(fm==='worn-out-media'&&rt==='sand') repairOptions.push({ruleId:'FILTER_REPAIR_FACTS',summary:RF[0].fact});
    if(fm==='worn-out-media'&&rt==='cartridge') repairOptions.push({ruleId:'FILTER_REPAIR_FACTS',summary:RF[1].fact});
    if(fm==='leaking-valve'&&rt==='sand') repairOptions.push({ruleId:'FILTER_REPAIR_FACTS',summary:RF[2].fact});
    // surface the near-misses first (largest disqualified = closest to passing)
    disq.sort((a,b)=>((b.product.tank||b.product.area||0)-(a.product.tank||a.product.area||0)));
    // before/after comparison when the user picked their current model
    let comparison=null;
    if(p.currentFilterId && cands[0]){
      const cur=DATA.filters.find(f=>f.id===p.currentFilterId), top=cands[0].product;
      if(cur){
        const curArea = cur.ft==='sand'?bedAreaOf(cur):cur.area;
        const recArea = top.ft==='sand'?bedAreaOf(top):top.area;
        const factor = (curArea&&recArea)?recArea/curArea:null;
        const sz=(f)=>f.ft==='sand'?`${f.tank}″ (${round1(bedAreaOf(f))} ft² bed)`:`${f.area} sq ft`;
        comparison={current:{model:`${cur.brand} ${cur.model}`,size:sz(cur)},
          recommended:{model:`${top.brand} ${top.model}`,size:sz(top)},factor};
      }
    }
    return {mode:'filter',chosenType,typeReasons,min,pumpMaxGPM,comparison,recommendations:cands.slice(0,8),disqualified:disq.slice(0,6),alternatives,repairOptions,warnings};
  }

  /* New-pool planner: runs all three engines on one profile and cross-checks them. */
  function padPlanner(p){
    const prof={...p,newBuild:true};
    const pump=pumpEngine(prof);
    const topPump=pump.recommendations[0]||null;
    const pumpMaxGPM = topPump ? topPump.computed.gpmAtCurveHigh : null;
    const filt=filterEngine({...prof,pumpMaxGPM,
      desiredType:prof.desiredType||'recommend',
      replacingType:'none',failureMode:'upgrading',
      debris:prof.debris||'average',waterCost:prof.waterCost||null});
    const swg=swgEngine({...prof,failure:'first',cycle:prof.cycle||'long'});
    const checks=[];
    const topFilt=filt.recommendations[0]||null, topSwg=swg.recommendations[0]||null;
    if(topPump&&topFilt){
      const cap=topFilt.computed.candidateMaxGPM;
      if(cap!=null&&pumpMaxGPM!=null){
        checks.push(cap>=pumpMaxGPM
          ? {code:'PAD_FLOW_OK',severity:'good',ruleId:'FILTER_MUST_NOT_BOTTLENECK_PUMP',
             text:`Filter handles ~${cap} GPM, above the ~${Math.round(pumpMaxGPM)} GPM the pump can push at full speed — no bottleneck.`}
          : {code:'PAD_FLOW_TIGHT',severity:'warning',ruleId:'FILTER_MUST_NOT_BOTTLENECK_PUMP',
             text:`Filter tops out near ~${cap} GPM but the pump can push ~${Math.round(pumpMaxGPM)} GPM — size the filter up, or plan to cap the pump's top speed.`});
      }
    }
    if(topSwg) checks.push({code:'PAD_SWG',severity:'good',ruleId:'SWG_2X_RULE',
      text:`Salt cell sized to the TFP 2\u00d7 rule for ${Number(p.gallons).toLocaleString()} gallons.`});
    if(p.automation&&p.automation!=='none') checks.push({code:'PAD_AUTOMATION',severity:'info',ruleId:'AUTOMATION_SAME_BRAND',
      text:`Keep pump, lights and salt cell on the same brand as your ${cap1(p.automation)} automation where you can — filters and heaters are brand-agnostic.`});
    else checks.push({code:'PAD_AUTOMATION_NONE',severity:'info',ruleId:'AUTOMATION_SAME_BRAND',
      text:'If you add automation later, keeping pump, lights and salt cell on one brand makes it far simpler.'});
    return {mode:'newpool',pump,filt,swg,checks,pumpMaxGPM,
      warnings:[].concat(pump.warnings||[],swg.warnings||[]).filter(w=>w.code!=='WARRANTY_CHECK')};
  }
  const cap1=x=>x?x.charAt(0).toUpperCase()+x.slice(1):x;
  function pipeCapGPM(pipe){const t=RULES.PLUMBING_SIZE_GUIDANCE.value.table;return t[pipe]||null;}
  function plumbingAdvice(p){
    if(!p.pipe||p.pipe==='unknown') return {code:'PIPE_UNKNOWN',severity:'info',ruleId:'PLUMBING_SIZE_GUIDANCE',
      text:'Pipe size not given — we sized conservatively (CEC curve A). Measuring your pipe gives a more accurate result.'};
    const cap=pipeCapGPM(p.pipe);
    if(!cap) return null;
    if(p.pipe==='1.5') return {code:'PIPE_SMALL',severity:'warning',ruleId:'PLUMBING_SIZE_GUIDANCE',
      text:`1.5″ plumbing holds about ${cap.suction} GPM on the suction side and ${cap.ret} GPM on returns before water moves too fast (6 and 8 ft/s). Beyond that you pay in friction, energy and noise — these are efficiency and noise guidelines rather than hard limits, and PVC will carry more if a specific application calls for it`+(p.newBuild?' — on a new build, going to 2″ now is the cheapest performance decision you will ever make.':'; running a variable-speed pump slower is the practical fix.')};
    if(p.newBuild) return {code:'PIPE_OK',severity:'good',ruleId:'PLUMBING_SIZE_GUIDANCE',
      text:`${p.pipe}″ plumbing carries about ${cap.suction} GPM suction / ${cap.ret} GPM return within the velocity limits — room to run the pump slowly and quietly, which is the right call on a new build.`};
    return {code:'PIPE_OK',severity:'info',ruleId:'PLUMBING_SIZE_GUIDANCE',
      text:`${p.pipe}″ plumbing carries about ${cap.suction} GPM suction / ${cap.ret} GPM return within the velocity limits.`};
  }
  function heaterBypassAdvice(p){
    if(!p.gasHeater) return null;
    const R=RULES.HEATER_BYPASS.value;
    return {code:'HEATER_BYPASS',severity:'info',ruleId:'HEATER_BYPASS',
      text:'Plumb in a heater bypass while you are at it. '+R.reasons[0]+' It also '+R.reasons[1].charAt(0).toLowerCase()+R.reasons[1].slice(1)+' And it '+R.reasons[2].charAt(0).toLowerCase()+R.reasons[2].slice(1)};
  }
  function warrantyAdvice(){
    return {code:'WARRANTY_CHECK',severity:'info',ruleId:'WARRANTY_CHECK',
      text:'Before you buy: check the warranty. Internet purchases and owner installation can void coverage on some brands, a few require a certified installer, and most require product registration. Bundled purchases with professional install sometimes carry a longer warranty.'};
  }

  /* ---------------- public API ---------------- */
  // Same output the web page shows: engine result plus the shared guidance
  // (plumbing, heater bypass, warranty) the page adds to every result.
  function recommend(mode, profile) {
    const p = profile || {};
    if (mode === "newpool") {
      const plan = padPlanner(p);
      const pa = plumbingAdvice({ ...p, newBuild: true });
      const hb = heaterBypassAdvice(p);
      return { ...plan, advice: [].concat(pa ? [pa] : [], plan.checks, plan.warnings, hb ? [hb] : [], [warrantyAdvice()]) };
    }
    const engine = mode === "pump" ? pumpEngine : mode === "swg" ? swgEngine : mode === "filter" ? filterEngine : null;
    if (!engine) throw new Error("recommend: unknown mode " + mode);
    const res = engine(p);
    const pa = plumbingAdvice(p), hb = heaterBypassAdvice(p);
    res.warnings = [].concat(pa ? [pa] : [], res.warnings || [], hb ? [hb] : [], [warrantyAdvice()]);
    return res;
  }

  return {
    recommend,
    pumpEngine, swgEngine, filterEngine, padPlanner,
    recommendFilterType, filterMinRequired, bedAreaOf, filterAllowGPM,
    plumbingAdvice, heaterBypassAdvice, warrantyAdvice, pipeCapGPM,
    estWattsAtGPM, canRunAtDailyFlow, pumpFingerprint, pumpName, stripBrand, curveIdx,
    num, money, clamp, cap, cap1, round1, round2, round3, FC_BY_CLIMATE,
    DATA, RULES
  };
}

return { createAdvisor };
});
