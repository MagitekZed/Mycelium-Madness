/*
  Mycelium Idle – Tier 1
  Core logic for resources, generators, biomes, substrates, prestige,
  mutations, and the ASCII substrate diorama.
*/
(function () {
  // -----------------------------
  // Core state
  // -----------------------------
  const state = {
    hyphae: 0,
    nutrients: 0,
    biomass: 0,
    spores: 0,

    generators: {
      branching: 0,
      leaf: 0,
      log: 0,
    },

    upgrades: {},

    activeMutation: null,
    mutationSelectionPending: false,
    mutationOptions: [],
    selectedMutationIndex: null,

    currentBiomeIndex: 0,
    runNumber: 1,

    // Substrate focus / concurrency
    simultaneousTargets: 1, // base: 1 active digestion slot
    activeSubstrateIds: [],
    selectedSubstrateId: null,
  };

  const modifiers = {
    hyphaeMultiplier: 1,
    clickMultiplier: 1,
    branchingMultiplier: 1,
    nutrientMultiplier: 1,
    leafMultiplier: 1,
    logMultiplier: 1,
    biomassMultiplier: 1,
    substrateSpeed: 1,
  };

  const activeTimers = [];

  // -----------------------------
  // Generators & rates
  // -----------------------------
  const generatorDefs = {
    branching: {
      name: "Branching Tip",
      baseCost: 10,
      resource: "hyphae",
      outputDesc: "Hyphae/sec",
      baseRate: 1,
    },
    leaf: {
      name: "Leaf Decomposer",
      baseCost: 50,
      resource: "hyphae",
      outputDesc: "Nutrients/sec",
      baseRate: 0.5,
    },
    log: {
      name: "Log Enzyme",
      baseCost: 100,
      resource: "nutrients",
      outputDesc: "Nutrients & Biomass/sec",
      baseNutrientRate: 0.2,
      baseBiomassRate: 0.05,
    },
  };

  const baseRates = {
    hyphaePerTip: generatorDefs.branching.baseRate,
    nutrientPerDecomposer: generatorDefs.leaf.baseRate,
    nutrientPerLog: generatorDefs.log.baseNutrientRate,
    biomassPerLog: generatorDefs.log.baseBiomassRate,
  };

  // -----------------------------
  // Biomes & substrates
  // -----------------------------
  const biomes = [
    {
      name: "Soil Patch",
      description: "+5% click hyphae",
      bonus() {
        modifiers.clickMultiplier += 0.05;
      },
      substrates: [
        {
          id: "debris1",
          type: "Small Debris",
          mass: 20,
          progress: 0,
          leafFactor: 0.0,
          logFactor: 0.0,
          branchingFactor: 0.2,
          dripReward: { hyphae: 0, nutrients: 0 },
          completionReward: { hyphae: 0, nutrients: 0, biomass: 0.1 },
        },
      ],
      unlocks: ["branching"],
    },
    {
      name: "Leaf Litter",
      description: "+10% nutrient output",
      bonus() {
        modifiers.nutrientMultiplier += 0.1;
      },
      substrates: (() => {
        const arr = [];
        for (let i = 0; i < 10; i++) {
          arr.push({
            id: "leaf" + i,
            type: "Leaf Pile",
            mass: 40,
            progress: 0,
            leafFactor: 1.0,
            logFactor: 0.0,
            branchingFactor: 0.1,
            dripReward: { hyphae: 0, nutrients: 0.1 },
            completionReward: { hyphae: 0, nutrients: 0, biomass: 0.3 },
          });
        }
        for (let i = 0; i < 3; i++) {
          arr.push({
            id: "twig" + i,
            type: "Twig Debris",
            mass: 25,
            progress: 0,
            leafFactor: 0.8,
            logFactor: 0.0,
            branchingFactor: 0.1,
            dripReward: { hyphae: 0, nutrients: 0.05 },
            completionReward: { hyphae: 0, nutrients: 0, biomass: 0.2 },
          });
        }
        return arr;
      })(),
      unlocks: ["leaf"],
    },
    {
      name: "Decaying Log",
      description: "+15% nutrient output & +50% biomass yield",
      bonus() {
        modifiers.nutrientMultiplier += 0.15;
        modifiers.biomassMultiplier += 0.5;
      },
      substrates: (() => {
        const arr = [];
        for (let i = 0; i < 5; i++) {
          arr.push({
            id: "log" + i,
            type: "Decaying Log",
            mass: 100,
            progress: 0,
            leafFactor: 0.2,
            logFactor: 1.0,
            branchingFactor: 0.05,
            dripReward: { hyphae: 0, nutrients: 0.05 },
            completionReward: { hyphae: 0, nutrients: 0, biomass: 2 },
          });
        }
        for (let i = 0; i < 2; i++) {
          arr.push({
            id: "bark" + i,
            type: "Bark Slab",
            mass: 60,
            progress: 0,
            leafFactor: 0.2,
            logFactor: 0.8,
            branchingFactor: 0.05,
            dripReward: { hyphae: 0, nutrients: 0.05 },
            completionReward: { hyphae: 0, nutrients: 0, biomass: 1 },
          });
        }
        return arr;
      })(),
      unlocks: ["log"],
    },
  ];

  // -----------------------------
  // Upgrades & mutations
  // -----------------------------
  const upgrades = {
    hyphaeBoost1: {
      name: "Hyphae Boost I",
      description: "+10% global Hyphae production",
      cost: 5,
      apply() {
        modifiers.hyphaeMultiplier += 0.1;
      },
    },
    clickBoost1: {
      name: "Click Efficiency I",
      description: "+20% manual Hyphae from clicking",
      cost: 5,
      apply() {
        modifiers.clickMultiplier += 0.2;
      },
    },
    branchingBoost1: {
      name: "Branching Tips Boost I",
      description: "+10% Branching Tip output",
      cost: 8,
      apply() {
        modifiers.branchingMultiplier += 0.1;
      },
    },
    nutrientBoost1: {
      name: "Nutrient Flow I",
      description: "+10% nutrient production",
      cost: 8,
      apply() {
        modifiers.nutrientMultiplier += 0.1;
      },
    },
    leafBoost1: {
      name: "Leaf Decomposer Boost I",
      description: "+15% Leaf Decomposer output",
      cost: 10,
      apply() {
        modifiers.leafMultiplier += 0.15;
      },
    },
    biomassBoost1: {
      name: "Biomass Gain I",
      description: "+5% biomass gain",
      cost: 10,
      apply() {
        modifiers.biomassMultiplier += 0.05;
      },
    },
    logBoost1: {
      name: "Log Enzyme Boost I",
      description: "+10% Log Enzyme biomass bonus",
      cost: 12,
      apply() {
        modifiers.logMultiplier += 0.1;
      },
    },
    // Example: future parallel digestion upgrade hook
    // parallelDigestion1: {
    //   name: "Parallel Digestion I",
    //   description: "+1 simultaneous substrate slot",
    //   cost: 15,
    //   apply() { state.simultaneousTargets += 1; }
    // },

    // Mutation unlocks
    unlockFocusedGrowth: {
      name: "Unlock Mutation: Focused Growth",
      description: "Adds Focused Growth mutation to the pool",
      cost: 10,
      apply() {
        if (!availableMutations.includes(mutationCards.focusedGrowth)) {
          availableMutations.push(mutationCards.focusedGrowth);
        }
      },
    },
    unlockLogEfficiency: {
      name: "Unlock Mutation: Log Efficiency",
      description: "Adds Log Enzyme Efficiency mutation to the pool",
      cost: 10,
      apply() {
        if (!availableMutations.includes(mutationCards.logEfficiency)) {
          availableMutations.push(mutationCards.logEfficiency);
        }
      },
    },
    unlockBurst: {
      name: "Unlock Mutation: Mycelial Burst",
      description: "Adds Runaway Mycelium Burst mutation to the pool",
      cost: 20,
      apply() {
        if (!availableMutations.includes(mutationCards.burst)) {
          availableMutations.push(mutationCards.burst);
        }
      },
    },
  };

  const mutationCards = {
    hyphaSurge: {
      name: "Hypha Surge",
      description: "+25% Hyphae production this run",
      effect() {
        modifiers.hyphaeMultiplier += 0.25;
      },
    },
    efficientBranching: {
      name: "Efficient Branching",
      description: "Branching Tips produce +15% more Hyphae this run",
      effect() {
        modifiers.branchingMultiplier += 0.15;
      },
    },
    acceleratedDecay: {
      name: "Accelerated Decay",
      description: "Leaf Decomposers generate +20% Nutrients this run",
      effect() {
        modifiers.leafMultiplier += 0.2;
      },
    },
    focusedGrowth: {
      name: "Focused Growth",
      description: "Clicking produces +50% more Hyphae this run",
      effect() {
        modifiers.clickMultiplier += 0.5;
      },
    },
    logEfficiency: {
      name: "Log Efficiency",
      description: "Log Enzymes produce +15% more Biomass this run",
      effect() {
        modifiers.logMultiplier += 0.15;
      },
    },
    burst: {
      name: "Runaway Mycelial Burst",
      description:
        "Every 60s gain a burst of Hyphae equal to 30s of Branching production",
      effect() {
        const interval = setInterval(() => {
          const production =
            state.generators.branching *
            baseRates.hyphaePerTip *
            modifiers.branchingMultiplier *
            modifiers.hyphaeMultiplier;
          const burstAmount = production * 30;
          state.hyphae += burstAmount;
          updateResourceDisplay();
        }, 60000);
        activeTimers.push(interval);
      },
    },
  };

  const availableMutations = [
    mutationCards.hyphaSurge,
    mutationCards.efficientBranching,
    mutationCards.acceleratedDecay,
  ];

  // -----------------------------
  // ASCII sprites for substrates
  // -----------------------------
  const SUBSTRATE_SPRITES = {
    "Leaf Pile": [
      // Frame 0 - fresh
      ["        /^^^^^\\", "      /^^^^^^^^^\\", "      \\^^^^^^^^^/"],
      // Frame 1 - mid
      ["        /^^^..^\\", "      /^^^##..^^\\", "      \\.##^^^^./"],
      // Frame 2 - almost gone
      ["        /.. . .\\", "      / .  ..  .\\", "      \\..   . ../"],
    ],
    "Twig Debris": [
      ["   \\  /  _   ", "    \\/  /_\\__", "    /\\    /   "],
      ["   \\   . _  ", "    \\/. /_.  ", "    .\\   .   "],
      ["    .   .   ", "     .. .   ", "      ...   "],
    ],
    "Decaying Log": [
      ["   ||==========||", "   ||==========||", "   ||==========||"],
      ["   ||====....==||", "   ||===......|||", "   ||==....====||"],
      ["   ||..      ..||", "   ||  ..  ..  ||", "   ||    ....  ||"],
    ],
    "Bark Slab": [
      ["   [////====\\\\\\\\]", "   [////====\\\\\\\\]"],
      ["   [//..==..\\\\\\]", "   [/..====..\\\\]"],
      ["   [ .  ..  . ]", "   [ ..    .. ]"],
    ],
    "Small Debris": [
      ["    .:::.   ", "   .:::::.  ", "    ':::'   "],
      ["    .::.    ", "    .:: .   ", "     ..     "],
      ["     .      ", "    ...     ", "     .      "],
    ],
  };

  function getSubstrateSprite(sub) {
    const frames = SUBSTRATE_SPRITES[sub.type];
    if (!frames || frames.length === 0) {
      return [sub.type];
    }
    const ratio = Math.min(1, sub.progress / sub.mass);
    let idx = 0;
    if (ratio >= 0.67) idx = 2;
    else if (ratio >= 0.34) idx = 1;
    const sprite = frames[idx];
    // Ensure array of lines
    return Array.isArray(sprite) ? sprite : [sprite];
  }

  // -----------------------------
  // Utility helpers
  // -----------------------------
  function getCost(genKey) {
    const def = generatorDefs[genKey];
    const count = state.generators[genKey];
    return Math.floor(def.baseCost * Math.pow(1.15, count));
  }

  function findSubstrateById(id) {
    const biome = biomes[state.currentBiomeIndex];
    return biome.substrates.find((s) => s.id === id) || null;
  }

  // Decide which substrates are actively decomposing this tick
  function allocateActiveSubstrates() {
    const biome = biomes[state.currentBiomeIndex];
    const pending = biome.substrates.filter((s) => s.progress < s.mass);
    const maxSlots = state.simultaneousTargets || 1;
    const newActive = [];
    const selectedId = state.selectedSubstrateId;

    // First, try to include the selected substrate if still pending
    if (selectedId) {
      const sel = pending.find((s) => s.id === selectedId);
      if (sel) newActive.push(selectedId);
    }

    // Keep old active ones if still pending and we have capacity
    if (state.activeSubstrateIds && state.activeSubstrateIds.length) {
      state.activeSubstrateIds.forEach((id) => {
        if (newActive.length >= maxSlots) return;
        if (newActive.includes(id)) return;
        const sub = pending.find((s) => s.id === id);
        if (sub) newActive.push(id);
      });
    }

    // Fill remaining slots from other pending substrates
    pending.forEach((sub) => {
      if (newActive.length >= maxSlots) return;
      if (newActive.includes(sub.id)) return;
      newActive.push(sub.id);
    });

    state.activeSubstrateIds = newActive;
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function updateResourceDisplay() {
    document.getElementById("hyphaeDisplay").innerText = Math.floor(
      state.hyphae
    );
    document.getElementById("nutrientsDisplay").innerText = Math.floor(
      state.nutrients
    );
    document.getElementById("biomassDisplay").innerText =
      state.biomass.toFixed(2);
    document.getElementById("sporePoolDisplay").innerText = Math.floor(
      state.spores
    );

    const runElem = document.getElementById("runDisplay");
    if (runElem) runElem.innerText = state.runNumber;

    renderGenerators();
  }

  function renderGenerators() {
    const container = document.getElementById("generatorsList");
    container.innerHTML = "";

    const biome = biomes[state.currentBiomeIndex];
    const unlocks = biome.unlocks || [];

    Object.keys(generatorDefs).forEach((key) => {
      const def = generatorDefs[key];
      const unlocked = unlocks.includes(key) || state.generators[key] > 0;
      if (!unlocked) return;

      const cost = getCost(key);
      const item = document.createElement("div");
      item.className = "generator-item";

      item.innerHTML = `
        <strong>${def.name}</strong><br>
        Count: ${state.generators[key]}<br>
        Produces: ${def.outputDesc}<br>
        Cost: ${cost} ${def.resource}<br>
      `;

      const btn = document.createElement("button");
      btn.innerText = `Buy ${def.name}`;
      btn.disabled = state[def.resource] < cost;
      btn.addEventListener("click", () => {
        if (state[def.resource] >= cost) {
          state[def.resource] -= cost;
          state.generators[key] += 1;
          updateResourceDisplay();
        }
      });

      item.appendChild(btn);
      container.appendChild(item);
    });
  }

  function renderUpgrades() {
    const list = document.getElementById("upgradeList");
    list.innerHTML = "";

    Object.keys(upgrades).forEach((id) => {
      const up = upgrades[id];
      const purchased = !!state.upgrades[id];

      const div = document.createElement("div");
      div.className = "upgrade-item";

      div.innerHTML = `
        <strong>${up.name}</strong> ${purchased ? "[Owned]" : ""}<br>
        ${up.description}<br>
        Cost: ${up.cost} spores
      `;

      const btn = document.createElement("button");
      btn.innerText = purchased ? "Purchased" : "Buy Upgrade";
      btn.disabled = purchased || state.spores < up.cost;

      btn.addEventListener("click", () => {
        if (purchased || state.spores < up.cost) return;
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

  function renderBiome() {
    const biome = biomes[state.currentBiomeIndex];
    document.getElementById("currentBiomeName").innerText = biome.name;
    document.getElementById("biomeBonus").innerText = biome.description;

    const remaining = biome.substrates.filter((s) => s.progress < s.mass)
      .length;
    const remainingSpan = document.getElementById("remainingSubstrates");
    if (remainingSpan) remainingSpan.innerText = remaining;

    const activeSlots = state.activeSubstrateIds.length;
    const activeSlotElem = document.getElementById("activeSlots");
    const maxSlotElem = document.getElementById("maxSlots");
    if (activeSlotElem) activeSlotElem.innerText = activeSlots;
    if (maxSlotElem) maxSlotElem.innerText = state.simultaneousTargets || 1;

    const canvas = document.getElementById("asciiCanvas");
    canvas.innerHTML = "";

    const indentLevels = [0, 4, 10, 2, 8, 6];

    biome.substrates.forEach((sub, idx) => {
      const isDone = sub.progress >= sub.mass;
      const isActive = state.activeSubstrateIds.includes(sub.id);
      const isSelected = state.selectedSubstrateId === sub.id;

      const wrapper = document.createElement("div");
      wrapper.className = "ascii-substrate";
      if (isActive) wrapper.classList.add("active");
      if (isSelected && !isDone) wrapper.classList.add("selected");

      const label = document.createElement("div");
      label.className = "ascii-substrate-label";

      let prefix = "";
      if (isActive && !isDone) prefix = "▶ ";
      else if (isSelected && !isDone) prefix = "> ";

      label.textContent =
        prefix + sub.type + (isDone ? " [Decomposed]" : "");
      wrapper.appendChild(label);

      const spriteLines = getSubstrateSprite(sub);
      const pre = document.createElement("pre");
      pre.textContent = spriteLines.join("\n");

      const indent = indentLevels[idx % indentLevels.length];
      wrapper.style.marginLeft = indent + "px";

      wrapper.appendChild(pre);

      if (!isDone) {
        wrapper.style.cursor = "pointer";
        wrapper.addEventListener("click", () => {
          state.selectedSubstrateId = sub.id;
          allocateActiveSubstrates();
          renderBiome();
        });
      }

      canvas.appendChild(wrapper);
    });

    const allDone = biome.substrates.every((s) => s.progress >= s.mass);
    document.getElementById("nextBiomeBtn").disabled = !allDone;
  }

  // -----------------------------
  // Game loop & prestige
  // -----------------------------
  function gameTick(delta) {
    // Resource production from generators
    const hyphaePerSec =
      state.generators.branching *
      baseRates.hyphaePerTip *
      modifiers.branchingMultiplier *
      modifiers.hyphaeMultiplier;

    const nutrientsFromLeaf =
      state.generators.leaf *
      baseRates.nutrientPerDecomposer *
      modifiers.leafMultiplier *
      modifiers.nutrientMultiplier;

    const nutrientsFromLog =
      state.generators.log *
      baseRates.nutrientPerLog *
      modifiers.logMultiplier *
      modifiers.nutrientMultiplier;

    const biomassFromLog =
      state.generators.log *
      baseRates.biomassPerLog *
      modifiers.logMultiplier *
      modifiers.biomassMultiplier;

    state.hyphae += hyphaePerSec * delta;
    state.nutrients += (nutrientsFromLeaf + nutrientsFromLog) * delta;
    state.biomass += biomassFromLog * delta;

    // Substrate decomposition
    const biome = biomes[state.currentBiomeIndex];
    allocateActiveSubstrates();

    biome.substrates.forEach((sub) => {
      if (sub.progress >= sub.mass) return;
      if (!state.activeSubstrateIds.includes(sub.id)) return;

      const contribution =
        state.generators.branching * sub.branchingFactor +
        state.generators.leaf * sub.leafFactor +
        state.generators.log * sub.logFactor;

      const rate = contribution * modifiers.substrateSpeed;
      sub.progress += rate * delta;

      if (sub.dripReward) {
        state.hyphae += (sub.dripReward.hyphae || 0) * delta;
        state.nutrients += (sub.dripReward.nutrients || 0) * delta;
      }

      if (sub.progress >= sub.mass && !sub.completed) {
        sub.completed = true;
        state.hyphae += sub.completionReward.hyphae || 0;
        state.nutrients += sub.completionReward.nutrients || 0;
        state.biomass += sub.completionReward.biomass || 0;

        if (state.selectedSubstrateId === sub.id) {
          state.selectedSubstrateId = null;
        }
      }
    });

    updateResourceDisplay();
    renderBiome();
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
    Object.keys(state.upgrades).forEach((id) => {
      if (state.upgrades[id]) {
        upgrades[id].apply();
      }
    });
  }

  function openMutationSelection() {
    state.mutationSelectionPending = true;
    const panel = document.getElementById("mutationChoice");
    panel.style.display = "block";

    const optionsContainer = document.getElementById("mutationOptions");
    optionsContainer.innerHTML = "";
    state.mutationOptions = [];

    const shuffled = [...availableMutations].sort(
      () => Math.random() - 0.5
    );
    const options = shuffled.slice(0, Math.min(3, shuffled.length));
    state.mutationOptions = options;
    state.selectedMutationIndex = null;

    options.forEach((card, idx) => {
      const div = document.createElement("div");
      div.className = "mutation-item";
      div.innerHTML = `<strong>${card.name}</strong><br>${card.description}`;
      div.addEventListener("click", () => {
        state.selectedMutationIndex = idx;
        Array.from(optionsContainer.children).forEach((el, i) => {
          if (i === idx) el.classList.add("selected");
          else el.classList.remove("selected");
        });
      });
      optionsContainer.appendChild(div);
    });
  }

  function prestige() {
    // Award spores based on biomass
    const earned = Math.floor(state.biomass / 10);
    state.spores += earned;

    // Reset resources & generators
    state.hyphae = 0;
    state.nutrients = 0;
    state.biomass = 0;

    state.generators.branching = 0;
    state.generators.leaf = 0;
    state.generators.log = 0;

    // Reset biome progression & substrates
    state.currentBiomeIndex = 0;
    biomes.forEach((b) => {
      b.substrates.forEach((sub) => {
        sub.progress = 0;
        delete sub.completed;
      });
    });

    // Next run
    state.runNumber += 1;

    // Reset mutation & timers
    activeTimers.forEach((id) => clearInterval(id));
    activeTimers.length = 0;
    state.activeMutation = null;

    // Reset modifiers, then reapply permanent upgrades
    resetModifiers();
    applyPermanentUpgrades();

    // Reset substrate focus
    state.activeSubstrateIds = [];
    state.selectedSubstrateId = null;

    // Open mutation selection for the run
    openMutationSelection();

    updateResourceDisplay();
    renderUpgrades();
    renderBiome();
  }

  // -----------------------------
  // Event listeners & init
  // -----------------------------
  document
    .getElementById("clickHyphaeBtn")
    .addEventListener("click", () => {
      const amt = 1 * modifiers.clickMultiplier * modifiers.hyphaeMultiplier;
      state.hyphae += amt;
      updateResourceDisplay();
    });

  document
    .getElementById("nextBiomeBtn")
    .addEventListener("click", () => {
      const biome = biomes[state.currentBiomeIndex];
      const allDone = biome.substrates.every(
        (s) => s.progress >= s.mass
      );
      if (!allDone) return;
      if (state.currentBiomeIndex < biomes.length - 1) {
        state.currentBiomeIndex += 1;
        // Apply new biome bonus
        biomes[state.currentBiomeIndex].bonus();
        state.activeSubstrateIds = [];
        state.selectedSubstrateId = null;
        updateResourceDisplay();
        renderBiome();
      }
    });

  document
    .getElementById("prestigeBtn")
    .addEventListener("click", () => {
      prestige();
    });

  document
    .getElementById("confirmMutationBtn")
    .addEventListener("click", () => {
      if (!state.mutationSelectionPending) return;
      if (
        state.selectedMutationIndex === null ||
        !state.mutationOptions[state.selectedMutationIndex]
      ) {
        return;
      }
      const chosen = state.mutationOptions[state.selectedMutationIndex];
      state.activeMutation = chosen;
      chosen.effect();
      state.mutationSelectionPending = false;
      document.getElementById("mutationChoice").style.display = "none";

      // Apply current biome bonus again (run is starting fresh in biome 0)
      biomes[state.currentBiomeIndex].bonus();
      updateResourceDisplay();
      renderBiome();
    });

  function initGame() {
    // Apply initial biome bonus (Soil Patch)
    biomes[state.currentBiomeIndex].bonus();

    updateResourceDisplay();
    renderUpgrades();
    renderBiome();
  }

  initGame();

  // Main loop
  let lastTime = Date.now();
  setInterval(() => {
    if (state.mutationSelectionPending) return;

    const now = Date.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    gameTick(delta);
  }, 250);
})();
