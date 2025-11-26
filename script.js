/*
  Tier 1 idle/clicker simulation logic extracted into its own file.
  This script drives the Mycelium Idle game, handling resources,
  generators, substrates, biomes, prestige, mutations and upgrades.
  The logic is self‑contained within an IIFE to avoid polluting the
  global namespace.  All DOM lookups reference IDs defined in the
  corresponding HTML markup.  See index.html for the structure.
*/
(function() {
  // Core state for the current run
  const state = {
    hyphae: 0,
    nutrients: 0,
    biomass: 0,
    spores: 0,
    // Purchased generator counts
    generators: {
      branching: 0,
      leaf: 0,
      log: 0
    },
    // Permanent upgrades purchased (true/false)
    upgrades: {},
    // Mutation for current run (object with modifiers)
    activeMutation: null,
    // Flags controlling UI / progress
    currentBiomeIndex: 0,
    runNumber: 1,
    mutationSelectionPending: false
    ,
    // How many substrates can be consumed simultaneously (increases via upgrades)
    simultaneousTargets: 1,
    // IDs of substrates currently being decomposed
    activeSubstrateIds: [],
    // Queue of user-selected substrates to target next
    selectionQueue: []
  };

  // Definition of permanent upgrades available in Tier 1
  const upgrades = {
    hyphaeBoost1: {
      name: 'Hyphae Boost I',
      description: '+10% global Hyphae production',
      cost: 5,
      apply() { modifiers.hyphaeMultiplier += 0.10; }
    },
    clickBoost1: {
      name: 'Click Efficiency I',
      description: '+20% manual Hyphae from clicking',
      cost: 5,
      apply() { modifiers.clickMultiplier += 0.20; }
    },
    branchingBoost1: {
      name: 'Branching Tips Boost I',
      description: '+10% Branching Tip output',
      cost: 8,
      apply() { modifiers.branchingMultiplier += 0.10; }
    },
    nutrientBoost1: {
      name: 'Nutrient Flow I',
      description: '+10% nutrient production',
      cost: 8,
      apply() { modifiers.nutrientMultiplier += 0.10; }
    },
    leafBoost1: {
      name: 'Leaf Decomposer Boost I',
      description: '+15% Leaf Decomposer output',
      cost: 10,
      apply() { modifiers.leafMultiplier += 0.15; }
    },
    biomassBoost1: {
      name: 'Biomass Gain I',
      description: '+5% biomass gain',
      cost: 10,
      apply() { modifiers.biomassMultiplier += 0.05; }
    },
    logBoost1: {
      name: 'Log Enzyme Boost I',
      description: '+10% Log Enzyme biomass bonus',
      cost: 12,
      apply() { modifiers.logMultiplier += 0.10; }
    },
    // Nodes to unlock mutation cards
    unlockFocusedGrowth: {
      name: 'Unlock Mutation: Focused Growth',
      description: 'Adds Focused Growth mutation to the pool',
      cost: 10,
      apply() {
        if(!availableMutations.includes(mutationCards.focusedGrowth)) availableMutations.push(mutationCards.focusedGrowth);
      }
    },
    unlockLogEfficiency: {
      name: 'Unlock Mutation: Log Efficiency',
      description: 'Adds Log Enzyme Efficiency mutation to the pool',
      cost: 10,
      apply() {
        if(!availableMutations.includes(mutationCards.logEfficiency)) availableMutations.push(mutationCards.logEfficiency);
      }
    },
    unlockBurst: {
      name: 'Unlock Mutation: Mycelial Burst',
      description: 'Adds Runaway Mycelium Burst mutation to the pool',
      cost: 20,
      apply() {
        if(!availableMutations.includes(mutationCards.burst)) availableMutations.push(mutationCards.burst);
      }
    },
    // Upgrade to allow consuming multiple substrates concurrently
    parallelConsumption1: {
      name: 'Parallel Digestion I',
      description: 'Consume +1 substrate simultaneously',
      cost: 15,
      apply() {
        state.simultaneousTargets += 1;
      }
    }
  };

  // Default multipliers (modified by upgrades/mutations)
  const modifiers = {
    hyphaeMultiplier: 1,
    clickMultiplier: 1,
    branchingMultiplier: 1,
    nutrientMultiplier: 1,
    leafMultiplier: 1,
    logMultiplier: 1,
    biomassMultiplier: 1,
    substrateSpeed: 1
  };

  // Mutation cards definitions (temporary per run)
  const mutationCards = {
    hyphaSurge: {
      name: 'Hypha Surge',
      description: '+25% Hyphae production this run',
      effect() { modifiers.hyphaeMultiplier += 0.25; }
    },
    efficientBranching: {
      name: 'Efficient Branching',
      description: 'Branching Tips produce +15% more Hyphae this run',
      effect() { modifiers.branchingMultiplier += 0.15; }
    },
    acceleratedDecay: {
      name: 'Accelerated Decay',
      description: 'Leaf Decomposers generate +20% Nutrients this run',
      effect() { modifiers.leafMultiplier += 0.20; }
    },
    // Locked at start; can be unlocked via spores
    focusedGrowth: {
      name: 'Focused Growth',
      description: 'Clicking produces +50% more Hyphae this run',
      effect() { modifiers.clickMultiplier += 0.50; }
    },
    logEfficiency: {
      name: 'Log Efficiency',
      description: 'Log Enzymes produce +15% more Biomass this run',
      effect() { modifiers.logMultiplier += 0.15; }
    },
    burst: {
      name: 'Runaway Mycelial Burst',
      description: 'Every 60 seconds gain a burst of Hyphae equal to 30 seconds of production',
      // For burst, we schedule a timer each run
      effect() {
        const interval = setInterval(() => {
          const production = (state.generators.branching * baseRates.hyphaePerTip * modifiers.branchingMultiplier * modifiers.hyphaeMultiplier);
          const burstAmount = production * 30;
          state.hyphae += burstAmount;
          updateResourceDisplay();
        }, 60000);
        activeTimers.push(interval);
      }
    }
  };

  // Initially available mutation cards (others unlocked via upgrades)
  const availableMutations = [
    mutationCards.hyphaSurge,
    mutationCards.efficientBranching,
    mutationCards.acceleratedDecay
  ];

  // Generators definitions with base cost and rate
  const generatorDefs = {
    branching: {
      name: 'Branching Tip',
      baseCost: 10,
      resource: 'hyphae',
      outputDesc: 'Hyphae/sec',
      baseRate: 1 // base hyphae per second per tip
    },
    leaf: {
      name: 'Leaf Decomposer',
      baseCost: 50,
      resource: 'hyphae',
      outputDesc: 'Nutrients/sec',
      baseRate: 0.5 // base nutrient per second per decomposer
    },
    log: {
      name: 'Log Enzyme',
      baseCost: 100,
      resource: 'nutrients',
      outputDesc: 'Nutrients & Biomass/sec',
      baseNutrientRate: 0.2,
      baseBiomassRate: 0.05
    }
  };

  // Base output rates used in calculations (subject to multipliers)
  const baseRates = {
    hyphaePerTip: generatorDefs.branching.baseRate,
    nutrientPerDecomposer: generatorDefs.leaf.baseRate,
    nutrientPerLog: generatorDefs.log.baseNutrientRate,
    biomassPerLog: generatorDefs.log.baseBiomassRate
  };

  // Biomes definitions
  const biomes = [
    {
      name: 'Soil Patch',
      description: '+5% click hyphae',
      bonus: () => { modifiers.clickMultiplier += 0.05; },
      substrates: [
        { id: 'debris1', type: 'Small Debris', mass: 20, progress: 0, leafFactor: 0.0, logFactor: 0.0, branchingFactor: 0.2, dripReward: { hyphae: 0, nutrients: 0 }, completionReward: { hyphae: 0, nutrients: 0, biomass: 0.1 } }
      ],
      unlocks: ['branching']
    },
    {
      name: 'Leaf Litter',
      description: '+10% nutrient output',
      bonus: () => { modifiers.nutrientMultiplier += 0.10; },
      substrates: (() => {
        const arr = [];
        for(let i=0;i<10;i++) arr.push({ id: 'leaf'+i, type: 'Leaf Pile', mass: 40, progress: 0, leafFactor: 1.0, logFactor: 0.0, branchingFactor: 0.1, dripReward: { hyphae: 0, nutrients: 0.1 }, completionReward: { hyphae: 0, nutrients: 0, biomass: 0.3 } });
        for(let i=0;i<3;i++) arr.push({ id: 'twig'+i, type: 'Twig Debris', mass: 25, progress: 0, leafFactor: 0.8, logFactor: 0.0, branchingFactor: 0.1, dripReward: { hyphae: 0, nutrients: 0.05 }, completionReward: { hyphae: 0, nutrients: 0, biomass: 0.2 } });
        return arr;
      })(),
      unlocks: ['leaf']
    },
    {
      name: 'Decaying Log',
      description: '+15% nutrient output & +50% biomass yield',
      bonus: () => { modifiers.nutrientMultiplier += 0.15; modifiers.biomassMultiplier += 0.50; },
      substrates: (() => {
        const arr = [];
        for(let i=0;i<5;i++) arr.push({ id: 'log'+i, type: 'Decaying Log', mass: 100, progress: 0, leafFactor: 0.2, logFactor: 1.0, branchingFactor: 0.05, dripReward: { hyphae: 0, nutrients: 0.05 }, completionReward: { hyphae: 0, nutrients: 0, biomass: 2 } });
        for(let i=0;i<2;i++) arr.push({ id: 'bark'+i, type: 'Bark Slab', mass: 60, progress: 0, leafFactor: 0.2, logFactor: 0.8, branchingFactor: 0.05, dripReward: { hyphae: 0, nutrients: 0.05 }, completionReward: { hyphae: 0, nutrients: 0, biomass: 1 } });
        return arr;
      })(),
      unlocks: ['log']
    }
  ];

  // Track timers for mutations that schedule intervals (e.g. bursts)
  const activeTimers = [];

  // Tier 1 goal definitions. Each goal has an id, description,
  // a progress function returning a current progress value, and a target.
  const tier1Goals = [
    {
      id: 'goal_hyphae',
      description: 'Produce 200 Hyphae',
      progress: () => Math.floor(state.hyphae),
      target: 200
    },
    {
      id: 'goal_nutrients',
      description: 'Generate 50 Nutrients',
      progress: () => Math.floor(state.nutrients),
      target: 50
    },
    {
      id: 'goal_biomass',
      description: 'Reach 5 Biomass',
      progress: () => Math.floor(state.biomass),
      target: 5
    },
    {
      id: 'goal_decompose_leaves',
      description: 'Fully decompose 3 Leaf Piles',
      progress: () => {
        const biome = biomes[1];
        if(!biome) return 0;
        return biome.substrates.filter(s => s.type === 'Leaf Pile' && s.progress >= s.mass).length;
      },
      target: 3
    },
    {
      id: 'goal_logs',
      description: 'Fully decompose 1 Log',
      progress: () => {
        const biome = biomes[2];
        if(!biome) return 0;
        return biome.substrates.filter(s => s.type === 'Decaying Log' && s.progress >= s.mass).length;
      },
      target: 1
    },
    {
      id: 'goal_reach_log',
      description: 'Reach the Log biome',
      progress: () => state.currentBiomeIndex >= 2 ? 1 : 0,
      target: 1
    },
    {
      id: 'goal_generators',
      description: 'Own 5 Branching Tips',
      progress: () => state.generators.branching,
      target: 5
    },
    {
      id: 'goal_leaf_generators',
      description: 'Own 3 Leaf Decomposers',
      progress: () => state.generators.leaf,
      target: 3
    }
  ];

  // Store currently selected goals and active goal
  let currentGoalOptions = [];
  let selectedGoalIndex = null;
  let activeGoal = null;

  /**
   * Select the next substrate to target for decomposition. If the player
   * has queued a selection (state.selectionQueue), that substrate takes
   * priority. Otherwise, pick the first incomplete substrate that is not
   * already being actively decomposed. Returns null if none available.
   */
  function pickNextSubstrate() {
    const biome = biomes[state.currentBiomeIndex];
    // If user has queued a specific substrate, try to select it
    if(state.selectionQueue.length > 0) {
      const id = state.selectionQueue.shift();
      const candidate = biome.substrates.find(s => s.id === id && s.progress < s.mass && !state.activeSubstrateIds.includes(id));
      if(candidate) {
        return candidate.id;
      }
    }
    // Otherwise pick first incomplete not active
    for(const sub of biome.substrates) {
      if(sub.progress < sub.mass && !state.activeSubstrateIds.includes(sub.id)) {
        return sub.id;
      }
    }
    return null;
  }

  /**
   * Add a substrate id to activeSubstrateIds if capacity allows.
   */
  function startSubstrate(id) {
    if(!id) return;
    if(state.activeSubstrateIds.includes(id)) return;
    if(state.activeSubstrateIds.length < state.simultaneousTargets) {
      state.activeSubstrateIds.push(id);
    }
  }

  /**
   * Handle user clicking on a substrate entry. Queues the substrate to
   * become active. If capacity is free, selection is applied immediately.
   */
  function onSubstrateClick(id) {
    // If substrate is already active, ignore click
    if(state.activeSubstrateIds.includes(id)) return;
    // If there is space, assign directly; otherwise queue for next
    if(state.activeSubstrateIds.length < state.simultaneousTargets) {
      state.selectionQueue = [id];
      // Immediately pick next to fill slot
      const nextId = pickNextSubstrate();
      if(nextId) startSubstrate(nextId);
    } else {
      // queue to replace next free slot
      state.selectionQueue = [id];
    }
    renderBiome();
  }

  // Utility: recalculate generator cost (exponential growth)
  function getCost(gen) {
    const def = generatorDefs[gen];
    const count = state.generators[gen];
    return Math.floor(def.baseCost * Math.pow(1.15, count));
  }

  // Update resource display and refresh generator buttons
  function updateResourceDisplay() {
    document.getElementById('hyphaeDisplay').innerText = Math.floor(state.hyphae);
    document.getElementById('nutrientsDisplay').innerText = Math.floor(state.nutrients);
    document.getElementById('biomassDisplay').innerText = state.biomass.toFixed(2);
    document.getElementById('sporePoolDisplay').innerText = Math.floor(state.spores);
    // Also update run display so player sees current generation
    const runElem = document.getElementById('runDisplay');
    if(runElem) runElem.innerText = state.runNumber;
    // Recompute generator button disabled/enabled status based on updated resources
    renderGenerators();
    // Update the stats and buffs panel
    updateStatsDisplay();
    // Update goal progress if a goal is active
    updateGoalProgress();
  }

  // Compute and display global statistics and active buffs
  function updateStatsDisplay() {
    // Calculate per click hyphae (base 1 multiplied by click and hyphae multipliers)
    const hyphaePerClick = 1 * modifiers.clickMultiplier * modifiers.hyphaeMultiplier;
    document.getElementById('hyphaePerClick').innerText = hyphaePerClick.toFixed(2);
    // Calculate per second resource generation from generators (ignoring substrate drips for simplicity)
    const hyphaePerSec = state.generators.branching * baseRates.hyphaePerTip * modifiers.branchingMultiplier * modifiers.hyphaeMultiplier;
    document.getElementById('hyphaePerSec').innerText = hyphaePerSec.toFixed(2);
    const nutrientsPerSec =
      (state.generators.leaf * baseRates.nutrientPerDecomposer * modifiers.leafMultiplier * modifiers.nutrientMultiplier) +
      (state.generators.log * baseRates.nutrientPerLog * modifiers.logMultiplier * modifiers.nutrientMultiplier);
    document.getElementById('nutrientsPerSec').innerText = nutrientsPerSec.toFixed(2);
    const biomassPerSec = state.generators.log * baseRates.biomassPerLog * modifiers.logMultiplier * modifiers.biomassMultiplier;
    document.getElementById('biomassPerSec').innerText = biomassPerSec.toFixed(2);
    // Estimate spores on prestige based on current biomass
    const sporesPrediction = Math.floor(state.biomass / 10);
    document.getElementById('sporesPerPrestige').innerText = sporesPrediction;
    // Show how many substrates can be consumed simultaneously and how many remain in current biome
    const concurrentSpan = document.getElementById('simultaneousTargets');
    if(concurrentSpan) concurrentSpan.innerText = state.simultaneousTargets;
    const remainingSpan = document.getElementById('remainingSubstrates');
    if(remainingSpan) {
      const biome = biomes[state.currentBiomeIndex];
      const remaining = biome.substrates.filter(sub => sub.progress < sub.mass).length;
      remainingSpan.innerText = remaining;
    }

    // Update left column substrate info counts
    const activeSpan = document.getElementById('activeSlotCount');
    const maxSpan = document.getElementById('maxSlotCount');
    const remainingCountSpan = document.getElementById('remainingCount');
    if(activeSpan) activeSpan.innerText = state.activeSubstrateIds.length;
    if(maxSpan) maxSpan.innerText = state.simultaneousTargets;
    if(remainingCountSpan) {
      const biome = biomes[state.currentBiomeIndex];
      const remaining = biome.substrates.filter(sub => sub.progress < sub.mass).length;
      remainingCountSpan.innerText = remaining;
    }
    // Build list of active buffs / multipliers
    const buffsDiv = document.getElementById('buffsList');
    if(!buffsDiv) return;
    const buffs = [];
    if(modifiers.hyphaeMultiplier !== 1) buffs.push(`Hyphae x${modifiers.hyphaeMultiplier.toFixed(2)}`);
    if(modifiers.clickMultiplier !== 1) buffs.push(`Click x${modifiers.clickMultiplier.toFixed(2)}`);
    if(modifiers.branchingMultiplier !== 1) buffs.push(`Branching x${modifiers.branchingMultiplier.toFixed(2)}`);
    if(modifiers.nutrientMultiplier !== 1) buffs.push(`Nutrient x${modifiers.nutrientMultiplier.toFixed(2)}`);
    if(modifiers.leafMultiplier !== 1) buffs.push(`Leaf x${modifiers.leafMultiplier.toFixed(2)}`);
    if(modifiers.logMultiplier !== 1) buffs.push(`Log x${modifiers.logMultiplier.toFixed(2)}`);
    if(modifiers.biomassMultiplier !== 1) buffs.push(`Biomass x${modifiers.biomassMultiplier.toFixed(2)}`);
    if(modifiers.substrateSpeed !== 1) buffs.push(`Substrate Speed x${modifiers.substrateSpeed.toFixed(2)}`);
    if(state.activeMutation) buffs.push(`Mutation: ${state.activeMutation.name}`);
    if(buffs.length === 0) {
      buffsDiv.innerHTML = '<em>No active buffs</em>';
    } else {
      buffsDiv.innerHTML = buffs.map(b => `<div>${b}</div>`).join('');
    }
  }

  // Render generator list
  function renderGenerators() {
    const container = document.getElementById('generatorsList');
    container.innerHTML = '';
    Object.keys(generatorDefs).forEach(key => {
      const def = generatorDefs[key];
      const biomeUnlocks = biomes[state.currentBiomeIndex].unlocks;
      const unlocked = biomeUnlocks.includes(key) || state.generators[key] > 0;
      if(!unlocked) return;
      const cost = getCost(key);
      const item = document.createElement('div');
      item.className = 'generator-item';
      item.innerHTML = `
        <strong>${def.name}</strong><br>
        Count: ${state.generators[key]}<br>
        Produces: ${def.outputDesc}<br>
        Cost: ${cost} ${def.resource}<br>
      `;
      const btn = document.createElement('button');
      btn.innerText = `Buy ${def.name}`;
      btn.disabled = state[def.resource] < cost;
      btn.addEventListener('click', () => {
        buyGenerator(key, cost);
      });
      item.appendChild(btn);
      container.appendChild(item);
    });
  }

  function buyGenerator(key, cost) {
    const def = generatorDefs[key];
    if(state[def.resource] >= cost) {
      state[def.resource] -= cost;
      state.generators[key]++;
      renderGenerators();
      updateResourceDisplay();
    }
  }

  // Render upgrades list
  function renderUpgrades() {
    const list = document.getElementById('upgradeList');
    list.innerHTML = '';
    Object.keys(upgrades).forEach(id => {
      const up = upgrades[id];
      const div = document.createElement('div');
      div.className = 'upgrade-item';
      const purchased = !!state.upgrades[id];
      div.innerHTML = `
        <strong>${up.name}</strong> ${purchased ? '[Owned]' : ''}<br>
        ${up.description}<br>
        Cost: ${up.cost} spores
      `;
      const btn = document.createElement('button');
      btn.innerText = purchased ? 'Purchased' : 'Buy Upgrade';
      btn.disabled = purchased || state.spores < up.cost;
      btn.addEventListener('click', () => {
        if(purchased || state.spores < up.cost) return;
        state.spores -= up.cost;
        state.upgrades[id] = true;
        up.apply();
        renderUpgrades();
        updateResourceDisplay();
      });
      div.appendChild(btn);
      list.appendChild(div);
    });
  }

  // Render current biome and substrates
  function renderBiome() {
    const biome = biomes[state.currentBiomeIndex];
    document.getElementById('currentBiomeName').innerText = biome.name;
    document.getElementById('biomeBonus').innerText = biome.description;
    const list = document.getElementById('substrateList');
    list.innerHTML = '';
    biome.substrates.forEach(sub => {
      const div = document.createElement('div');
      div.className = 'substrate-item';
      const done = sub.progress >= sub.mass;
      // Determine if this substrate is currently targeted
      const active = state.activeSubstrateIds.includes(sub.id);
      // Build ASCII progress bar (10 segments)
      const ratio = Math.min(1, sub.progress / sub.mass);
      const segments = 10;
      const filled = Math.round(ratio * segments);
      const asciiBar = '[' + '#'.repeat(filled) + '.'.repeat(segments - filled) + ']';
      // Compose label: prefix arrow if active
      let label = `${asciiBar}`;
      if(active) {
        label = '➤ ' + label;
      } else {
        label = '  ' + label;
      }
      // Title line includes type and status
      let status = '';
      if(done) status = ' [Decomposed]';
      div.innerHTML = `<code>${label}</code> <strong>${sub.type}</strong>${status}`;
      // Click to select this substrate (unless done)
      if(!done) {
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => onSubstrateClick(sub.id));
      }
      list.appendChild(div);
    });
    const allDone = biome.substrates.every(sub => sub.progress >= sub.mass);
    document.getElementById('nextBiomeBtn').disabled = !allDone;
  }

  // Advance to next biome
  function nextBiome() {
    if(state.currentBiomeIndex < biomes.length - 1) {
      state.currentBiomeIndex++;
      // apply new biome bonus
      biomes[state.currentBiomeIndex].bonus();
      renderGenerators();
      renderBiome();
    }
  }

  // Run update loop: produce resources and decompose substrates
  function gameTick(delta) {
    // Resource production from generators
    const hyphaePerTick = state.generators.branching * baseRates.hyphaePerTip * modifiers.branchingMultiplier * modifiers.hyphaeMultiplier;
    state.hyphae += hyphaePerTick * delta;
    const nutrientsFromLeaf = state.generators.leaf * baseRates.nutrientPerDecomposer * modifiers.leafMultiplier * modifiers.nutrientMultiplier;
    const nutrientsFromLog = state.generators.log * baseRates.nutrientPerLog * modifiers.logMultiplier * modifiers.nutrientMultiplier;
    const biomassFromLog = state.generators.log * baseRates.biomassPerLog * modifiers.logMultiplier * modifiers.biomassMultiplier;
    state.nutrients += (nutrientsFromLeaf + nutrientsFromLog) * delta;
    state.biomass += biomassFromLog * delta;

    // Decompose substrates on active target list
    const biome = biomes[state.currentBiomeIndex];
    // If fewer active substrates than capacity, pick next targets
    while(state.activeSubstrateIds.length < state.simultaneousTargets) {
      const nextId = pickNextSubstrate();
      if(!nextId) break;
      startSubstrate(nextId);
    }
    // Process each active substrate
    state.activeSubstrateIds = state.activeSubstrateIds.filter(id => {
      const sub = biome.substrates.find(s => s.id === id);
      if(!sub || sub.progress >= sub.mass) {
        return false;
      }
      // Calculate contribution from generators scaled by substrate factors
      const contribution =
        state.generators.branching * sub.branchingFactor +
        state.generators.leaf * sub.leafFactor +
        state.generators.log * sub.logFactor;
      const rate = contribution * modifiers.substrateSpeed;
      sub.progress += rate * delta;
      // Drip rewards accumulate continuously
      if(sub.dripReward) {
        state.hyphae += (sub.dripReward.hyphae || 0) * delta;
        state.nutrients += (sub.dripReward.nutrients || 0) * delta;
      }
      // Apply completion reward once when done
      if(sub.progress >= sub.mass && !sub.completed) {
        sub.completed = true;
        state.hyphae += sub.completionReward.hyphae || 0;
        state.nutrients += sub.completionReward.nutrients || 0;
        state.biomass += sub.completionReward.biomass || 0;
        return false; // remove from active list
      }
      return true; // keep active
    });
    updateResourceDisplay();
    renderBiome();
  }

  // Prestige: end run, award spores based on biomass, reset state (except permanent upgrades & spore pool)
  function prestige() {
    // Award spores based on total biomass
    const earned = Math.floor(state.biomass / 10);
    state.spores += earned;
    // Reset basic resources
    state.hyphae = 0;
    state.nutrients = 0;
    state.biomass = 0;
    // Reset generators
    state.generators.branching = 0;
    state.generators.leaf = 0;
    state.generators.log = 0;
    // Reset progression
    state.currentBiomeIndex = 0;
    state.runNumber++;
    // Reset substrate targeting properties
    state.simultaneousTargets = 1;
    state.activeSubstrateIds = [];
    state.selectionQueue = [];
    // Reset all temporary modifiers
    resetModifiers();
    // Reapply permanent upgrades purchased so far
    applyPermanentUpgrades();
    // Clear mutation timers
    activeTimers.forEach(id => clearInterval(id));
    activeTimers.length = 0;
    // Clear active mutation
    state.activeMutation = null;
    // Reset substrate progress
    biomes.forEach(biome => {
      biome.substrates.forEach(sub => {
        sub.progress = 0;
        delete sub.completed;
      });
    });
    // Show mutation selection panel
    state.mutationSelectionPending = true;
    document.getElementById('mutationChoice').style.display = 'flex';
    const optionsContainer = document.getElementById('mutationOptions');
    optionsContainer.innerHTML = '';
    const shuffled = [...availableMutations].sort(() => Math.random() - 0.5);
    const options = shuffled.slice(0, Math.min(3, shuffled.length));
    options.forEach((card, idx) => {
      const div = document.createElement('div');
      div.className = 'mutation-item';
      div.innerHTML = `<strong>${card.name}</strong><br>${card.description}`;
      div.addEventListener('click', () => {
        Array.from(optionsContainer.children).forEach(el => el.style.borderColor = 'var(--panel-border)');
        div.style.borderColor = '#ff0';
        selectedMutationIndex = idx;
      });
      optionsContainer.appendChild(div);
    });
    selectedMutationIndex = null;
    // Re-render game components
    renderGenerators();
    renderBiome();
    renderUpgrades();
    updateResourceDisplay();
  }

  function resetModifiers() {
    modifiers.hyphaeMultiplier = 1;
    modifiers.clickMultiplier = 1;
    modifiers.branchingMultiplier = 1;
    modifiers.nutrientMultiplier = 1;
    modifiers.leafMultiplier = 1;
    modifiers.logMultiplier = 1;
    modifiers.biomassMultiplier = 1;
    modifiers.substrateSpeed = 1;
  }
  function applyPermanentUpgrades() {
    Object.keys(state.upgrades).forEach(id => {
      if(state.upgrades[id]) {
        upgrades[id].apply();
      }
    });
  }

  // Mutation selection handlers
  let selectedMutationIndex = null;
  document.getElementById('confirmMutationBtn').addEventListener('click', () => {
    if(state.mutationSelectionPending) {
      const optionsContainer = document.getElementById('mutationOptions');
      if(selectedMutationIndex === null) return;
      // Build a pool identical to the one displayed (we tracked indices)
      const displayedCards = Array.from(optionsContainer.children).map((el, idx) => {
        // The mutation options are in the same order as options array above
        return null;
      });
      // Because we can't easily tie back to the card object via DOM, we instead generate a fresh pool from availableMutations and index into the original 'options' array we captured in prestige()'s scope.
      // However, since scope is lost here, we'll recompute the pool again consistent with prestige() logic.
      const shuffled = [...availableMutations].sort(() => Math.random() - 0.5);
      const pool = shuffled.slice(0, Math.min(3, shuffled.length));
      const chosen = pool[selectedMutationIndex];
      state.activeMutation = chosen;
      chosen.effect();
      document.getElementById('mutationChoice').style.display = 'none';
      state.mutationSelectionPending = false;
      // Immediately apply the current biome bonus after mutation selection
      biomes[state.currentBiomeIndex].bonus();
      renderGenerators();
      renderBiome();
      updateResourceDisplay();
    }
  });

  // Event listeners
  document.getElementById('clickHyphaeBtn').addEventListener('click', () => {
    const amt = 1 * modifiers.clickMultiplier * modifiers.hyphaeMultiplier;
    state.hyphae += amt;
    updateResourceDisplay();
  });
  document.getElementById('nextBiomeBtn').addEventListener('click', nextBiome);
  document.getElementById('prestigeBtn').addEventListener('click', () => {
    prestige();
  });

  // Show upgrades overlay when clicking upgrades button
  const upgradesBtn = document.getElementById('upgradesBtn');
  if(upgradesBtn) {
    upgradesBtn.addEventListener('click', () => {
      // Render upgrades list into overlay and show it
      renderUpgrades();
      document.getElementById('upgradeOverlay').style.display = 'flex';
    });
  }
  // Close upgrades overlay button
  const closeUpgradeBtn = document.getElementById('closeUpgradeBtn');
  if(closeUpgradeBtn) {
    closeUpgradeBtn.addEventListener('click', () => {
      document.getElementById('upgradeOverlay').style.display = 'none';
    });
  }

  // Initial render
  function initGame() {
    // Apply starting biome bonus
    biomes[state.currentBiomeIndex].bonus();
    renderGenerators();
    renderBiome();
    renderUpgrades();
    updateResourceDisplay();
    // At the start of a run (runNumber 1 or after prestige), prompt goal selection
    if(state.runNumber === 1) {
      openGoalSelection();
    }
  }
  initGame();

  // Main game loop
  let lastTime = Date.now();
  setInterval(() => {
    if(state.mutationSelectionPending) return;
    const now = Date.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    gameTick(delta);
  }, 250);

  /**
   * Open the tier goal selection overlay. Randomly selects 3 goals
   * from the tier1Goals pool. The player must choose one to start
   * the run. Progress for the selected goal is tracked during
   * gameplay and displayed in the overlay when reopened.
   */
  function openGoalSelection() {
    // Only open if not already active
    const overlay = document.getElementById('goalOverlay');
    if(!overlay) return;
    // Shuffle and pick 3 goals
    const shuffled = [...tier1Goals].sort(() => Math.random() - 0.5);
    currentGoalOptions = shuffled.slice(0, Math.min(3, tier1Goals.length));
    selectedGoalIndex = null;
    // Render list
    const list = document.getElementById('goalList');
    list.innerHTML = '';
    currentGoalOptions.forEach((goal, idx) => {
      const div = document.createElement('div');
      div.className = 'goal-item';
      div.innerHTML = `<strong>${goal.description}</strong><br>`;
      // Add progress bar container
      const progressBar = document.createElement('div');
      progressBar.className = 'goal-progress';
      // We'll update progress later
      div.appendChild(progressBar);
      div.addEventListener('click', () => {
        // Reset border colors on other items
        Array.from(list.children).forEach(el => {
          el.style.borderColor = 'var(--panel-border)';
        });
        div.style.borderColor = '#ff0';
        selectedGoalIndex = idx;
        document.getElementById('confirmGoalBtn').style.display = 'block';
      });
      list.appendChild(div);
    });
    document.getElementById('confirmGoalBtn').style.display = 'none';
    overlay.style.display = 'flex';
  }

  /**
   * Update goal progress bars and check completion. If the active goal
   * is complete, display a message and mark it complete. This runs
   * after each resource update.
   */
  function updateGoalProgress() {
    // If there is no active goal, nothing to update
    if(!activeGoal) return;
    const list = document.getElementById('goalList');
    // find active goal element by index if selectedGoalIndex not null
    if(list && activeGoal) {
      currentGoalOptions.forEach((goal, idx) => {
        const prog = Math.min(goal.progress(), goal.target);
        const ratio = goal.target > 0 ? prog / goal.target : 0;
        const bar = list.children[idx].querySelector('.goal-progress');
        if(bar) {
          const segments = 10;
          const filled = Math.round(ratio * segments);
          bar.textContent = '[' + '#'.repeat(filled) + '.'.repeat(segments - filled) + `] ${prog}/${goal.target}`;
        }
      });
    }
    // If active goal completed
    const prog = activeGoal.progress();
    if(prog >= activeGoal.target && !activeGoal.completed) {
      activeGoal.completed = true;
      // Optionally reward spores or just mark complete
      // Could display notification or automatically progress tier; for now, just show message
      console.log('Goal completed:', activeGoal.description);
    }
  }

  // Handle goal confirmation
  const confirmGoalBtn = document.getElementById('confirmGoalBtn');
  if(confirmGoalBtn) {
    confirmGoalBtn.addEventListener('click', () => {
      if(selectedGoalIndex === null) return;
      activeGoal = currentGoalOptions[selectedGoalIndex];
      // Hide goal overlay
      document.getElementById('goalOverlay').style.display = 'none';
      // Initialize progress display immediately
      updateGoalProgress();
    });
  }
})();