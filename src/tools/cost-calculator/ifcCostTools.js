const LINE_PATTERN = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*;?$/i;

const COST_ELEMENT_TYPES = new Set([
  "IFCBEAM",
  "IFCBUILDINGELEMENTPROXY",
  "IFCCOLUMN",
  "IFCCOVERING",
  "IFCCURTAINWALL",
  "IFCDISTRIBUTIONELEMENT",
  "IFCDOOR",
  "IFCELEMENTASSEMBLY",
  "IFCFOOTING",
  "IFCMEMBER",
  "IFCPILE",
  "IFCPLATE",
  "IFCRAILING",
  "IFCRAMP",
  "IFCROOF",
  "IFCSLAB",
  "IFCSPACE",
  "IFCSTAIR",
  "IFCWALL",
  "IFCWALLSTANDARDCASE",
  "IFCWINDOW",
]);

const QUANTITY_META = {
  IFCQUANTITYAREA: { valueIndex: 3, unit: "m2" },
  IFCQUANTITYCOUNT: { valueIndex: 3, unit: "St" },
  IFCQUANTITYLENGTH: { valueIndex: 3, unit: "m" },
  IFCQUANTITYTIME: { valueIndex: 3, unit: "h" },
  IFCQUANTITYVOLUME: { valueIndex: 3, unit: "m3" },
  IFCQUANTITYWEIGHT: { valueIndex: 3, unit: "kg" },
};

const QUANTITY_PRIORITY = [
  "NetSideArea",
  "NetArea",
  "NetFloorArea",
  "NetVolume",
  "GrossSideArea",
  "GrossArea",
  "GrossFloorArea",
  "GrossVolume",
  "ProjectedArea",
  "Length",
  "Height",
  "Width",
  "ElementCount",
];

const DEFAULT_RATE_LIBRARY = [
  {
    id: "wall-area",
    label: "Wall construction",
    elementType: "IFCWALL",
    costGroup: "",
    unit: "m2",
    quantityName: "NetSideArea",
    rate: 185,
    active: true,
  },
  {
    id: "wall-standard-area",
    label: "Standard wall construction",
    elementType: "IFCWALLSTANDARDCASE",
    costGroup: "",
    unit: "m2",
    quantityName: "NetSideArea",
    rate: 185,
    active: true,
  },
  {
    id: "slab-volume",
    label: "Slab construction",
    elementType: "IFCSLAB",
    costGroup: "",
    unit: "m3",
    quantityName: "NetVolume",
    rate: 380,
    active: true,
  },
  {
    id: "roof-area",
    label: "Roof construction",
    elementType: "IFCROOF",
    costGroup: "",
    unit: "m2",
    quantityName: "NetArea",
    rate: 160,
    active: true,
  },
  {
    id: "covering-area",
    label: "Covering / finish",
    elementType: "IFCCOVERING",
    costGroup: "",
    unit: "m2",
    quantityName: "NetArea",
    rate: 55,
    active: true,
  },
  ...[
    ["door-count", "Door", "IFCDOOR", "St", "ElementCount", 650],
    ["window-count", "Window", "IFCWINDOW", "St", "ElementCount", 520],
    ["column-volume", "Column", "IFCCOLUMN", "m3", "NetVolume", 520],
    ["beam-volume", "Beam", "IFCBEAM", "m3", "NetVolume", 500],
    ["footing-volume", "Footing", "IFCFOOTING", "m3", "NetVolume", 390],
    ["pile-volume", "Pile", "IFCPILE", "m3", "NetVolume", 430],
    ["stair-area", "Stair", "IFCSTAIR", "m2", "NetArea", 350],
    ["curtain-wall-area", "Curtain wall", "IFCCURTAINWALL", "m2", "NetSideArea", 480],
    ["railing-length", "Railing", "IFCRAILING", "m", "Length", 320],
    ["space-area", "Space", "IFCSPACE", "m2", "NetFloorArea", 0],
    [
      "stair-count-fallback",
      "Stair fallback per item",
      "IFCSTAIR",
      "St",
      "ElementCount",
      5000,
    ],
    [
      "railing-count-fallback",
      "Railing fallback per item",
      "IFCRAILING",
      "St",
      "ElementCount",
      2500,
    ],
  ].map(([id, label, elementType, unit, quantityName, rate]) => ({
    id,
    label,
    elementType,
    costGroup: "",
    unit,
    quantityName,
    rate,
    active: true,
  })),
];

const DEFAULT_CLASSIFICATION_MAPPINGS = [
  ["332", "Nichttragende Aussenwaende", "332"],
  ["335", "Aussenwandbekleidungen, aussen", "335"],
  ["336", "Aussenwandbekleidungen, innen", "336"],
  ["342", "Nichttragende Innenwaende", "342"],
  ["344", "Innenwandoeffnungen", "344"],
  ["345", "Innenwandbekleidungen", "345"],
  ["346", "Elementierte Innenwandkonstruktionen", "346"],
  ["351", "Deckenkonstruktionen", "351"],
  ["353", "Deckenbelaege", "353"],
  ["364", "Dachbekleidungen", "364"],
  ["B10", "Uniformat B10 - review required", ""],
].map(([sourceCode, label, dinGroup]) => ({
  id: `uniformat-${sourceCode.toLowerCase()}-din`,
  sourceSystem: "Uniformat",
  sourceCode,
  label,
  dinGroup,
  active: true,
}));

export function createDefaultClassificationMappings() {
  return DEFAULT_CLASSIFICATION_MAPPINGS.map((entry) => ({ ...entry }));
}

export function normalizeClassificationMappings(entries) {
  if (!Array.isArray(entries)) return createDefaultClassificationMappings();

  return entries
    .map((entry, index) => ({
      id: String(entry.id || `classification-map-${index + 1}`),
      sourceSystem: String(entry.sourceSystem || "").trim(),
      sourceCode: String(entry.sourceCode || "").trim(),
      label: String(entry.label || "").trim(),
      dinGroup: String(entry.dinGroup || "").trim(),
      active: entry.active !== false,
    }))
    .filter((entry) => entry.sourceSystem && entry.sourceCode);
}

export function mergeClassificationMappings(entries, catalog = []) {
  const normalized = normalizeClassificationMappings(entries);
  const known = new Set(
    normalized.map((entry) =>
      classificationMappingKey(entry.sourceSystem, entry.sourceCode)
    )
  );
  const additions = [];

  catalog.forEach((classification) => {
    const key = classificationMappingKey(
      classification.system,
      classification.code
    );
    if (!classification.system || !classification.code || known.has(key)) return;

    known.add(key);
    additions.push({
      id: `classification-map-${slugify(classification.system)}-${slugify(classification.code)}`,
      sourceSystem: classification.system,
      sourceCode: classification.code,
      label: classification.name || classification.display || "Discovered in IFC",
      dinGroup: "",
      active: true,
    });
  });

  return additions.length ? normalized.concat(additions) : entries;
}

export function createDefaultRateLibrary() {
  return DEFAULT_RATE_LIBRARY.map((entry) => ({
    ifcTypeName: "",
    ...entry,
  }));
}

export function buildCostAnalysis(
  text,
  targetFgk = "300",
  classificationMappings = createDefaultClassificationMappings()
) {
  const { records } = parseIfcLines(text);
  const levelsByElement = buildElementLevels(records);
  const typesByElement = buildElementTypes(records);
  const propertySets = buildPropertySets(records);
  const quantitySets = buildQuantitySets(records);
  const normalizedMappings = normalizeClassificationMappings(classificationMappings);
  const propertiesByElement = new Map();
  const classificationsByElement = new Map();
  const elementsWithQuantities = new Set();
  const quantityRows = [];

  // Pass 1: collect every property and classification relationship first.
  // Large IFC exports commonly place classification associations after QTO rows.
  for (const record of records.values()) {
    if (record.type === "IFCRELDEFINESBYPROPERTIES") {
      const relatedElementIds = parseRefList(record.args[4]);
      const definitionId = parseRef(record.args[5]);
      const propertySet = propertySets.get(definitionId);

      if (propertySet) {
        relatedElementIds.forEach((elementId) => {
          const nextProperties = propertiesByElement.get(elementId) || [];
          propertiesByElement.set(
            elementId,
            nextProperties.concat(propertySet.properties)
          );
        });
      }
    }

    if (record.type === "IFCRELASSOCIATESCLASSIFICATION") {
      const relatedElementIds = parseRefList(record.args[4]);
      const classificationId = parseRef(record.args[5]);
      const classification = parseClassification(
        records.get(classificationId),
        records
      );

      relatedElementIds.forEach((elementId) => {
        if (!classification) return;
        const nextClassifications = classificationsByElement.get(elementId) || [];
        const key = classificationMappingKey(
          classification.system,
          classification.code
        );
        if (
          !nextClassifications.some(
            (entry) =>
              classificationMappingKey(entry.system, entry.code) === key
          )
        ) {
          classificationsByElement.set(
            elementId,
            nextClassifications.concat(classification)
          );
        }
      });
    }
  }

  // Pass 2: create quantity rows only after metadata is complete.
  for (const record of records.values()) {
    if (record.type !== "IFCRELDEFINESBYPROPERTIES") continue;

    const relatedElementIds = parseRefList(record.args[4]);
    const definitionId = parseRef(record.args[5]);
    const quantitySet = quantitySets.get(definitionId);
    if (!quantitySet) continue;

    relatedElementIds.forEach((elementId) => {
      const element = records.get(elementId);
      if (!isCostElement(element)) return;

      elementsWithQuantities.add(elementId);
      quantitySet.quantities.forEach((quantity) => {
        quantityRows.push(
          makeQuantityRow({
            element,
            quantitySet,
            quantity,
            properties: propertiesByElement.get(elementId) || [],
            classifications: classificationsByElement.get(elementId) || [],
            classificationMappings: normalizedMappings,
            ifcType: typesByElement.get(elementId),
          })
        );
      });
    });
  }

  const fallbackRows = [];
  for (const element of records.values()) {
    if (!isCostElement(element) || elementsWithQuantities.has(element.id)) continue;

    fallbackRows.push(
      makeQuantityRow({
        element,
        quantitySet: { id: null, name: "Missing QTO" },
        quantity: {
          id: null,
          name: "ElementCount",
          type: "IFCQUANTITYCOUNT",
          value: 1,
          unit: "St",
          fallback: true,
        },
        properties: propertiesByElement.get(element.id) || [],
        classifications: classificationsByElement.get(element.id) || [],
        classificationMappings: normalizedMappings,
        ifcType: typesByElement.get(element.id),
      })
    );
  }

  const rows = quantityRows
    .concat(fallbackRows)
    .map((row) => ({
      ...row,
      ...(levelsByElement.get(row.elementId) || {
        levelId: null,
        level: "Unassigned",
        levelElevation: null,
      }),
    }))
    .map((row) => ({
      ...row,
      readiness: getReadiness(row, targetFgk),
    }))
    .sort((a, b) => {
      return (
        String(a.level).localeCompare(String(b.level), undefined, { numeric: true }) ||
        a.elementType.localeCompare(b.elementType) ||
        String(a.costGroup).localeCompare(String(b.costGroup)) ||
        a.elementId - b.elementId ||
        a.quantityName.localeCompare(b.quantityName)
      );
    });

  return {
    rows,
    classificationCatalog: buildClassificationCatalog(rows),
    summary: summarizeCostRows(rows, targetFgk),
  };
}

export function applyClassificationMappings(
  analysis,
  classificationMappings,
  targetFgk = "300"
) {
  const mappings = normalizeClassificationMappings(classificationMappings);
  const rows = (analysis?.rows || [])
    .map((row) => {
      const resolution = resolveCostGroup(
        row.properties || [],
        row.classifications || [],
        mappings
      );
      const mappedRow = {
        ...row,
        costGroup: resolution.costGroup,
        costGroupSource: resolution.source,
        costGroupMappingId: resolution.mappingId,
      };
      return {
        ...mappedRow,
        readiness: getReadiness(mappedRow, targetFgk),
      };
    })
    .sort((a, b) => {
      return (
        String(a.level).localeCompare(String(b.level), undefined, { numeric: true }) ||
        a.elementType.localeCompare(b.elementType) ||
        String(a.costGroup).localeCompare(String(b.costGroup)) ||
        a.elementId - b.elementId ||
        a.quantityName.localeCompare(b.quantityName)
      );
    });

  return {
    ...analysis,
    rows,
    summary: summarizeCostRows(rows, targetFgk),
  };
}

export function filterCostRows(rows, filters, overrides = {}) {
  const search = normalize(filters.search);
  const level = String(filters.level || "");
  const entity = normalize(filters.entityType);
  const ifcTypeName = normalize(filters.ifcTypeName);
  const unit = normalize(filters.unit);
  const costGroup = normalize(filters.costGroup);
  const quantityName = normalize(filters.quantityName);
  const pricingStatus = filters.pricingStatus || "";
  const readiness = filters.readiness || "";

  return rows.filter((row) => {
    const searchable = normalize(
      [
        row.elementId,
        row.elementType,
        row.elementGlobalId,
        row.elementName,
        row.ifcTypeName,
        row.ifcTypeClass,
        row.level,
        row.levelElevation,
        row.quantitySetName,
        row.quantityName,
        row.costGroup,
        row.classification,
        row.classificationSystem,
        row.classificationCode,
        row.classificationName,
        row.costGroupSource,
        row.fgk,
      ].join(" ")
    );

    return (
      (!search || searchable.includes(search)) &&
      (!level ||
        (level === "unassigned"
          ? row.levelId === null
          : String(row.levelId) === level)) &&
      (!entity || normalize(row.elementType).includes(entity)) &&
      (!ifcTypeName || normalize(row.ifcTypeName) === ifcTypeName) &&
      (!unit || normalize(row.unit).includes(unit)) &&
      (!costGroup || normalize(row.costGroup).includes(costGroup)) &&
      (!quantityName || normalize(row.quantityName).includes(quantityName)) &&
      (!pricingStatus ||
        (getRowRateSource(row, overrides) === "No matching rate"
          ? "unpriced"
          : "priced") === pricingStatus) &&
      (!readiness || row.readiness.level === readiness)
    );
  });
}

export function normalizeRateLibrary(entries) {
  if (!Array.isArray(entries)) return createDefaultRateLibrary();

  return entries
    .map((entry, index) => {
      const rate = Number(entry.rate);
      return {
        id: String(entry.id || `rate-${index + 1}`),
        label: String(entry.label || "Unnamed rate").trim(),
        elementType: String(entry.elementType || "").trim().toUpperCase(),
        ifcTypeName: String(entry.ifcTypeName || "").trim(),
        costGroup: String(entry.costGroup || "").trim(),
        unit: String(entry.unit || "").trim(),
        quantityName: String(entry.quantityName || "").trim(),
        rate: Number.isFinite(rate) ? Math.max(0, rate) : 0,
        active: entry.active !== false,
      };
    })
    .filter((entry) => entry.elementType && entry.unit);
}

export function applyCostRules(
  rows,
  rateLibrary = createDefaultRateLibrary(),
  basisOverrides = {}
) {
  const rules = normalizeRateLibrary(rateLibrary).filter((entry) => entry.active);
  const rowsByElement = new Map();

  rows.forEach((row) => {
    const group = rowsByElement.get(row.elementId) || [];
    group.push(row);
    rowsByElement.set(row.elementId, group);
  });

  return Array.from(rowsByElement.values())
    .map((elementRows) => {
      const baseRow = elementRows[0];
      const elementRules = rules
        .filter((rule) => ruleMatchesElement(rule, baseRow))
        .sort(
          (a, b) =>
            rateRuleSpecificity(b) - rateRuleSpecificity(a)
        );
      const candidates = elementRows.slice();

      if (
        elementRules.some((rule) => rule.unit === "St") &&
        !candidates.some((row) => row.unit === "St")
      ) {
        candidates.push(makeCountCandidate(baseRow));
      }

      const overrideRowId = basisOverrides[baseRow.elementId];
      let selected = candidates.find((row) => row.rowId === overrideRowId) || null;
      let rateRule = selected ? findRateRule(selected, elementRules) : null;
      let selectionReason = selected ? "Manual pricing basis" : "";

      if (!selected) {
        for (const rule of elementRules) {
          const unitCandidates = candidates.filter((row) => row.unit === rule.unit);
          if (!unitCandidates.length) continue;

          selected = selectPreferredQuantity(unitCandidates, rule.quantityName);
          rateRule = rule;
          selectionReason = rule.quantityName
            ? `Rule preference: ${rule.quantityName}`
            : `Rule unit: ${rule.unit}`;
          break;
        }
      }

      if (!selected) {
        selected = selectPreferredQuantity(candidates, "");
        selectionReason = "No matching rate rule";
      }

      if (!rateRule) rateRule = findRateRule(selected, elementRules);
      const hasModelRate =
        selected.modelRate !== null &&
        selected.modelRate !== undefined &&
        Number.isFinite(Number(selected.modelRate));

      const selectedIsRawQuantity = !selected.ruleGenerated;
      const excludedQuantityCount = Math.max(
        0,
        elementRows.length - (selectedIsRawQuantity ? 1 : 0)
      );
      const pricingCandidates = candidates.map((candidate) => ({
        rowId: candidate.rowId,
        quantityName: candidate.quantityName,
        quantityValue: candidate.quantityValue,
        quantitySetName: candidate.quantitySetName,
        unit: candidate.unit,
        ruleGenerated: Boolean(candidate.ruleGenerated),
      }));

      return {
        ...selected,
        rateRuleId: rateRule?.id || "",
        rateRuleScope: rateRule?.ifcTypeName ? "type" : rateRule ? "class" : "",
        rateRuleLabel:
          rateRule?.label || (hasModelRate ? "IFC model rate" : "No matching rate"),
        ruleRate: rateRule ? rateRule.rate : null,
        pricingStatus: rateRule || hasModelRate ? "priced" : "unpriced",
        selectionReason,
        pricingCandidates,
        excludedQuantityCount,
      };
    })
    .sort((a, b) => {
      return (
        String(a.level).localeCompare(String(b.level), undefined, { numeric: true }) ||
        a.elementType.localeCompare(b.elementType) ||
        a.elementId - b.elementId
      );
    });
}

export function getRowRate(row, overrides = {}) {
  const override = overrides[row.rowId];
  if (override !== undefined && override !== "") return Number(override) || 0;
  if (
    row.modelRate !== null &&
    row.modelRate !== undefined &&
    Number.isFinite(Number(row.modelRate))
  ) {
    return Number(row.modelRate) || 0;
  }
  if (row.ruleRate !== null && row.ruleRate !== undefined) {
    return Number(row.ruleRate) || 0;
  }
  return 0;
}

export function getRowRateSource(row, overrides = {}) {
  const override = overrides[row.rowId];
  if (override !== undefined && override !== "") return "Manual override";
  if (
    row.modelRate !== null &&
    row.modelRate !== undefined &&
    Number.isFinite(Number(row.modelRate))
  ) {
    return "IFC model rate";
  }
  if (row.rateRuleId) {
    return row.rateRuleScope === "type" ? "IFC type rate" : "IFC class rate";
  }
  return "No matching rate";
}

export function summarizeCosts(rows, overrides = {}) {
  return rows.reduce(
    (summary, row) => {
      const rate = getRowRate(row, overrides);
      const total = row.quantityValue * rate;

      summary.total += Number.isFinite(total) ? total : 0;
      summary.quantity += row.quantityValue;
      summary.items += 1;
      summary.elements.add(row.elementId);
      summary.excludedQuantities += row.excludedQuantityCount || 0;
      if (getRowRateSource(row, overrides) === "No matching rate") summary.unpriced += 1;
      if (row.fallback) summary.fallbacks += 1;
      if (!row.costGroup) summary.missingCostGroups += 1;
      return summary;
    },
    {
      total: 0,
      quantity: 0,
      items: 0,
      elements: new Set(),
      unpriced: 0,
      excludedQuantities: 0,
      fallbacks: 0,
      missingCostGroups: 0,
    }
  );
}

export function buildCostBreakdown(rows, overrides = {}, groupBy = "level") {
  const groups = new Map();

  rows.forEach((row) => {
    const group = getBreakdownGroup(row, groupBy);
    const current = groups.get(group.value) || {
      value: group.value,
      label: group.label,
      total: 0,
      items: 0,
      elements: new Set(),
      unpriced: 0,
    };
    const rowTotal = row.quantityValue * getRowRate(row, overrides);

    current.total += Number.isFinite(rowTotal) ? rowTotal : 0;
    current.items += 1;
    current.elements.add(row.elementId);
    if (getRowRateSource(row, overrides) === "No matching rate") current.unpriced += 1;
    groups.set(group.value, current);
  });

  const total = Array.from(groups.values()).reduce(
    (sum, group) => sum + group.total,
    0
  );

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      elementCount: group.elements.size,
      share: total > 0 ? group.total / total : 0,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function ruleMatchesElement(rule, row) {
  if (rule.elementType !== row.elementType) return false;
  if (rule.ifcTypeName && normalize(rule.ifcTypeName) !== normalize(row.ifcTypeName)) {
    return false;
  }
  if (!rule.costGroup) return true;
  return costGroupMatches(rule.costGroup, row.costGroup);
}

function rateRuleSpecificity(rule) {
  return (rule.ifcTypeName ? 100 : 0) + costGroupRuleSpecificity(rule.costGroup);
}

function costGroupMatches(ruleGroup, elementGroup) {
  const rule = String(ruleGroup || "").trim();
  const element = String(elementGroup || "").trim();
  if (!rule || !element) return false;
  if (rule === element) return true;
  if (!/^\d{3}$/.test(rule) || !/^\d{3}(?:\.|$)/.test(element)) return false;

  const significantPrefix = rule.replace(/0+$/, "");
  return significantPrefix.length < rule.length && element.startsWith(significantPrefix);
}

function costGroupRuleSpecificity(costGroup) {
  const group = String(costGroup || "").trim();
  if (!group) return 0;
  if (!/^\d{3}$/.test(group)) return 4;
  return group.replace(/0+$/, "").length + 1;
}

function findRateRule(row, rules) {
  return (
    rules.find(
      (rule) => rule.unit === row.unit && ruleMatchesElement(rule, row)
    ) || null
  );
}

function selectPreferredQuantity(rows, preferredName) {
  const preferred = normalize(preferredName);

  return rows.slice().sort((a, b) => {
    const aExact = preferred && normalize(a.quantityName) === preferred ? 0 : 1;
    const bExact = preferred && normalize(b.quantityName) === preferred ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    const aPriority = QUANTITY_PRIORITY.indexOf(a.quantityName);
    const bPriority = QUANTITY_PRIORITY.indexOf(b.quantityName);
    const safeAPriority = aPriority === -1 ? QUANTITY_PRIORITY.length : aPriority;
    const safeBPriority = bPriority === -1 ? QUANTITY_PRIORITY.length : bPriority;

    return (
      safeAPriority - safeBPriority ||
      Number(Boolean(a.fallback)) - Number(Boolean(b.fallback)) ||
      a.rowId.localeCompare(b.rowId)
    );
  })[0];
}

function makeCountCandidate(baseRow) {
  return {
    ...baseRow,
    rowId: `${baseRow.elementId}-pricing-count`,
    quantitySetId: null,
    quantitySetName: "Cost rule",
    quantityId: null,
    quantityName: "ElementCount",
    quantityType: "IFCQUANTITYCOUNT",
    quantityValue: 1,
    unit: "St",
    fallback: false,
    ruleGenerated: true,
  };
}

function getBreakdownGroup(row, groupBy) {
  if (groupBy === "costGroup") {
    return {
      value: row.costGroup || "",
      label: row.costGroup || "Unclassified",
    };
  }

  if (groupBy === "elementType") {
    return { value: row.elementType, label: row.elementType };
  }

  return {
    value: row.levelId === null ? "unassigned" : String(row.levelId),
    label: row.level || "Unassigned",
  };
}

export function exportCostRowsCsv(rows, overrides = {}) {
  const header = [
    "ElementId",
    "GlobalId",
    "IFCType",
    "IFCTypeName",
    "ElementName",
    "Level",
    "LevelElevation",
    "CostGroup",
    "CostGroupSource",
    "ClassificationSystem",
    "ClassificationCode",
    "ClassificationName",
    "Classification",
    "FGK",
    "PricingRule",
    "PricingStatus",
    "RateSource",
    "QuantitySet",
    "QuantityId",
    "PricingBasis",
    "Quantity",
    "Unit",
    "UnitRateEUR",
    "TotalEUR",
    "ExcludedQuantityRows",
    "Readiness",
  ];

  const lines = rows.map((row) => {
    const rate = getRowRate(row, overrides);
    return [
      row.elementId,
      row.elementGlobalId,
      row.elementType,
      row.ifcTypeName,
      row.elementName,
      row.level,
      row.levelElevation ?? "",
      row.costGroup,
      row.costGroupSource,
      row.classificationSystem,
      row.classificationCode,
      row.classificationName,
      row.classification,
      row.fgk,
      row.rateRuleLabel || "",
      row.pricingStatus || "",
      getRowRateSource(row, overrides),
      row.quantitySetName,
      row.quantityId || "",
      row.quantityName,
      formatNumber(row.quantityValue),
      row.unit,
      formatNumber(rate),
      formatNumber(row.quantityValue * rate),
      row.excludedQuantityCount || 0,
      row.readiness.label,
    ]
      .map(csvCell)
      .join(",");
  });

  return [header.join(","), ...lines].join("\n");
}

export function buildCostSnapshot({
  name,
  text,
  targetFgk = "300",
  overrides = {},
  rateLibrary = createDefaultRateLibrary(),
  classificationMappings = createDefaultClassificationMappings(),
  basisOverrides = {},
}) {
  const analysis = buildCostAnalysis(
    text,
    targetFgk,
    classificationMappings
  );
  const pricedRows = applyCostRules(analysis.rows, rateLibrary, basisOverrides);
  const elements = new Map();

  pricedRows.forEach((row) => {
    const uniqueId = row.elementGlobalId || `#${row.elementId}`;
    const rate = getRowRate(row, overrides);
    const total = row.quantityValue * rate;
    const current = elements.get(uniqueId) || {
      unique_id: uniqueId,
      element_id: row.elementId,
      category: row.elementType,
      family: row.costGroup || row.classification || "Unclassified",
      type: row.ifcTypeName || row.elementType,
      level: row.level || "Unassigned",
      workset: row.classification || "No classification",
      creator: "",
      last_changed_by: "",
      totalCost: 0,
      quantityCount: 0,
      parameters: {
        "IFC Name": row.elementName || "",
        "IFC Type Name": row.ifcTypeName || "",
        "IFC Type Class": row.ifcTypeClass || "",
        GlobalId: row.elementGlobalId || "",
        "Building Storey": row.level || "Unassigned",
        "Storey Elevation": row.levelElevation ?? "",
        "Cost Group": row.costGroup || "",
        "Cost Group Source": row.costGroupSource || "",
        "Classification System": row.classificationSystem || "",
        "Classification Code": row.classificationCode || "",
        "Classification Name": row.classificationName || "",
        Classification: row.classification || "",
        FGK: row.fgk || "",
        "Pricing Rule": row.rateRuleLabel || "No matching rate",
        "Pricing Basis": `${row.quantityName} (${row.unit})`,
        "Pricing Status": row.pricingStatus,
        "Excluded Quantity Rows": row.excludedQuantityCount || 0,
      },
    };

    current.totalCost += Number.isFinite(total) ? total : 0;
    current.quantityCount += 1;
    current.parameters[`QTO: ${row.quantitySetName} / ${row.quantityName}`] =
      `${formatNumber(row.quantityValue)} ${row.unit}`;
    current.parameters[`Rate: ${row.quantityName} (${row.unit})`] =
      `${formatNumber(rate)} EUR/${row.unit}`;
    elements.set(uniqueId, current);
  });

  const snapshotElements = Array.from(elements.values()).map((element) => ({
    ...element,
    parameters: {
      ...element.parameters,
      "Priced Work Items": element.quantityCount,
      "Total Cost EUR": formatNumber(element.totalCost),
    },
  }));

  return {
    project_name: name || "IFC model",
    timestamp: new Date().toISOString(),
    elements: snapshotElements,
    rows: pricedRows,
    summary: summarizeCosts(pricedRows, overrides),
    totalCost: snapshotElements.reduce((sum, element) => sum + element.totalCost, 0),
  };
}

export function compareCostSnapshots(oldSnapshot, newSnapshot) {
  const oldElements = new Map(
    (oldSnapshot?.elements || []).map((element) => [element.unique_id, element])
  );
  const newElements = new Map(
    (newSnapshot?.elements || []).map((element) => [element.unique_id, element])
  );
  const added = [];
  const deleted = [];
  const modified = [];

  for (const [uniqueId, newElement] of newElements) {
    if (!oldElements.has(uniqueId)) added.push(newElement);
  }

  for (const [uniqueId, oldElement] of oldElements) {
    if (!newElements.has(uniqueId)) deleted.push(oldElement);
  }

  for (const [uniqueId, newElement] of newElements) {
    const oldElement = oldElements.get(uniqueId);
    if (!oldElement) continue;

    const changes = compareElementFields(oldElement, newElement);
    if (changes.length) {
      modified.push({
        ...newElement,
        unique_id: uniqueId,
        changes,
        oldTotalCost: oldElement.totalCost,
        newTotalCost: newElement.totalCost,
        costDelta: newElement.totalCost - oldElement.totalCost,
      });
    }
  }

  const addedCost = added.reduce((sum, element) => sum + element.totalCost, 0);
  const deletedCost = deleted.reduce((sum, element) => sum + element.totalCost, 0);
  const modifiedDelta = modified.reduce((sum, element) => sum + element.costDelta, 0);

  return {
    projectName: newSnapshot?.project_name || oldSnapshot?.project_name || "IFC model",
    oldTimestamp: oldSnapshot?.timestamp || "Baseline",
    newTimestamp: newSnapshot?.timestamp || "Target",
    added,
    deleted,
    modified,
    totals: {
      oldCost: oldSnapshot?.totalCost || 0,
      newCost: newSnapshot?.totalCost || 0,
      delta: (newSnapshot?.totalCost || 0) - (oldSnapshot?.totalCost || 0),
      addedCost,
      deletedCost,
      modifiedDelta,
      netElements: added.length - deleted.length,
    },
  };
}

export function exportCostComparisonCsv(comparison) {
  const header = [
    "Status",
    "GlobalId",
    "ElementId",
    "IFCType",
    "CostGroup",
    "OldCostEUR",
    "NewCostEUR",
    "DeltaEUR",
    "Changes",
  ];

  const lines = [
    ...comparison.added.map((element) =>
      comparisonLine("Added", null, element, element.totalCost, [])
    ),
    ...comparison.deleted.map((element) =>
      comparisonLine("Deleted", element, null, -element.totalCost, [])
    ),
    ...comparison.modified.map((element) =>
      comparisonLine(
        "Modified",
        { ...element, totalCost: element.oldTotalCost },
        element,
        element.costDelta,
        element.changes
      )
    ),
  ];

  return [header.join(","), ...lines].join("\n");
}

function compareElementFields(oldElement, newElement) {
  const changes = [];
  const fields = ["category", "family", "type", "level", "workset"];

  fields.forEach((field) => {
    if ((oldElement[field] || "") !== (newElement[field] || "")) {
      changes.push({
        property: field.charAt(0).toUpperCase() + field.slice(1),
        old: oldElement[field] ?? null,
        new: newElement[field] ?? null,
      });
    }
  });

  const oldParameters = oldElement.parameters || {};
  const newParameters = newElement.parameters || {};
  Object.keys(oldParameters).forEach((name) => {
    if (newParameters[name] === undefined) {
      changes.push({ property: `Param: ${name}`, old: oldParameters[name], new: null });
    } else if (String(oldParameters[name]) !== String(newParameters[name])) {
      changes.push({
        property: `Param: ${name}`,
        old: oldParameters[name],
        new: newParameters[name],
      });
    }
  });
  Object.keys(newParameters).forEach((name) => {
    if (oldParameters[name] === undefined) {
      changes.push({ property: `Param: ${name}`, old: null, new: newParameters[name] });
    }
  });

  return changes;
}

function comparisonLine(status, oldElement, newElement, delta, changes) {
  const element = newElement || oldElement;
  return [
    status,
    element.unique_id,
    element.element_id,
    element.category,
    element.family,
    formatNumber(oldElement?.totalCost || 0),
    formatNumber(newElement?.totalCost || 0),
    formatNumber(delta),
    changes.map((change) => `${change.property}: ${change.old ?? ""} -> ${change.new ?? ""}`).join("; "),
  ]
    .map(csvCell)
    .join(",");
}

function parseIfcLines(text) {
  const records = new Map();

  String(text || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const match = line.trim().match(LINE_PATTERN);
      if (!match) return;

      const id = Number(match[1]);
      records.set(id, {
        id,
        type: match[2].toUpperCase(),
        argsText: match[3],
        args: splitTopLevel(match[3]),
        line,
        lineIndex: index,
      });
    });

  return { records };
}

function buildElementLevels(records) {
  const containedIn = new Map();
  const parentByChild = new Map();
  const levelsByElement = new Map();

  for (const record of records.values()) {
    if (record.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      const structureId = parseRef(record.args[5]);
      if (structureId !== null) {
        parseRefList(record.args[4]).forEach((elementId) => {
          containedIn.set(elementId, structureId);
        });
      }
    }

    if (record.type === "IFCRELAGGREGATES" || record.type === "IFCRELNESTS") {
      const parentId = parseRef(record.args[4]);
      if (parentId !== null) {
        parseRefList(record.args[5]).forEach((childId) => {
          if (!parentByChild.has(childId)) parentByChild.set(childId, parentId);
        });
      }
    }
  }

  const describeStorey = (record) => {
    const elevation = parseNumber(record.args[9]);
    return {
      levelId: record.id,
      level:
        cleanIfcString(record.args[2]) ||
        cleanIfcString(record.args[7]) ||
        `Storey #${record.id}`,
      levelElevation: Number.isFinite(elevation) ? elevation : null,
    };
  };

  const findStorey = (startId) => {
    const visited = new Set();
    let currentId = startId;

    while (currentId !== null && currentId !== undefined && !visited.has(currentId)) {
      visited.add(currentId);
      const current = records.get(currentId);
      if (current?.type === "IFCBUILDINGSTOREY") return describeStorey(current);
      currentId = parentByChild.get(currentId);
    }

    return null;
  };

  const resolveLevel = (elementId) => {
    const visited = new Set();
    let currentId = elementId;

    while (currentId !== null && currentId !== undefined && !visited.has(currentId)) {
      visited.add(currentId);

      const directStorey = findStorey(currentId);
      if (directStorey) return directStorey;

      const structureId = containedIn.get(currentId);
      if (structureId !== undefined) {
        const containingStorey = findStorey(structureId);
        if (containingStorey) return containingStorey;
      }

      currentId = parentByChild.get(currentId);
    }

    return null;
  };

  for (const record of records.values()) {
    if (!isCostElement(record)) continue;
    const level = resolveLevel(record.id);
    if (level) levelsByElement.set(record.id, level);
  }

  return levelsByElement;
}

function buildElementTypes(records) {
  const typesByElement = new Map();

  for (const relation of records.values()) {
    if (relation.type !== "IFCRELDEFINESBYTYPE") continue;

    const typeId = parseRef(relation.args[5]);
    const typeRecord = records.get(typeId);
    if (!typeRecord) continue;

    const typeName =
      cleanIfcString(typeRecord.args[2]) ||
      cleanIfcString(typeRecord.args[8]) ||
      `${typeRecord.type} #${typeRecord.id}`;
    const typeInfo = {
      id: typeRecord.id,
      className: typeRecord.type,
      globalId: cleanIfcString(typeRecord.args[0]),
      name: typeName,
    };

    parseRefList(relation.args[4]).forEach((elementId) => {
      typesByElement.set(elementId, typeInfo);
    });
  }

  return typesByElement;
}

function buildPropertySets(records) {
  const propertySets = new Map();

  for (const record of records.values()) {
    if (record.type !== "IFCPROPERTYSET") continue;

    const propertyIds = parseRefList(record.args[4]);
    const properties = propertyIds
      .map((propertyId) => parseProperty(records.get(propertyId), record))
      .filter(Boolean);

    propertySets.set(record.id, {
      id: record.id,
      name: cleanIfcString(record.args[2]) || `#${record.id}`,
      properties,
    });
  }

  return propertySets;
}

function buildQuantitySets(records) {
  const quantitySets = new Map();

  for (const record of records.values()) {
    if (record.type !== "IFCELEMENTQUANTITY") continue;

    const quantityIds = parseRefList(record.args[5] || record.args[4]);
    const quantities = quantityIds
      .map((quantityId) => parseQuantity(records.get(quantityId)))
      .filter(Boolean);

    quantitySets.set(record.id, {
      id: record.id,
      name: cleanIfcString(record.args[2]) || `#${record.id}`,
      quantities,
    });
  }

  return quantitySets;
}

function parseProperty(record, propertySet) {
  if (!record || record.type !== "IFCPROPERTYSINGLEVALUE") return null;
  const nominal = parseNominalValue(record.args[2]);

  return {
    id: record.id,
    psetId: propertySet.id,
    psetName: cleanIfcString(propertySet.args[2]) || `#${propertySet.id}`,
    name: cleanIfcString(record.args[0]) || `#${record.id}`,
    value: nominal.value,
    display: nominal.display,
    wrapper: nominal.wrapper,
  };
}

function parseQuantity(record) {
  const meta = QUANTITY_META[record?.type];
  if (!record || !meta) return null;

  return {
    id: record.id,
    type: record.type,
    name: cleanIfcString(record.args[0]) || `#${record.id}`,
    value: parseNumber(record.args[meta.valueIndex]),
    unit: meta.unit,
  };
}

function makeQuantityRow({
  element,
  quantitySet,
  quantity,
  properties,
  classifications = [],
  classificationMappings = [],
  ifcType = null,
}) {
  const globalId = cleanIfcString(element.args[0]);
  const name = cleanIfcString(element.args[2]);
  const ifcTypeName = ifcType?.name || cleanIfcString(element.args[4]);
  const primaryClassification = classifications[0] || null;
  const classification = primaryClassification?.display || "";
  const costGroupResolution = resolveCostGroup(
    properties,
    classifications,
    classificationMappings
  );
  const fgk = extractFgk(properties);
  const modelRate = extractModelRate(properties);

  return {
    rowId: `${element.id}-${quantitySet.id || "fallback"}-${quantity.id || quantity.name}`,
    elementId: element.id,
    elementType: element.type,
    elementGlobalId: globalId,
    elementName: name,
    ifcTypeId: ifcType?.id || null,
    ifcTypeClass: ifcType?.className || "",
    ifcTypeGlobalId: ifcType?.globalId || "",
    ifcTypeName,
    quantitySetId: quantitySet.id,
    quantitySetName: quantitySet.name,
    quantityId: quantity.id,
    quantityName: quantity.name,
    quantityType: quantity.type,
    quantityValue: Number.isFinite(quantity.value) ? quantity.value : 0,
    unit: quantity.unit,
    properties,
    classifications,
    classification,
    classificationSystem: primaryClassification?.system || "",
    classificationCode: primaryClassification?.code || "",
    classificationName: primaryClassification?.name || "",
    costGroup: costGroupResolution.costGroup,
    costGroupSource: costGroupResolution.source,
    costGroupMappingId: costGroupResolution.mappingId,
    fgk,
    modelRate,
    fallback: Boolean(quantity.fallback),
  };
}

function buildClassificationCatalog(rows) {
  const catalog = new Map();

  rows.forEach((row) => {
    (row.classifications || []).forEach((classification) => {
      const key = classificationMappingKey(
        classification.system,
        classification.code
      );
      const current = catalog.get(key) || {
        ...classification,
        elements: new Set(),
      };
      current.elements.add(row.elementId);
      catalog.set(key, current);
    });
  });

  return Array.from(catalog.values())
    .map((entry) => ({
      id: entry.id,
      system: entry.system,
      code: entry.code,
      name: entry.name,
      display: entry.display,
      elementCount: entry.elements.size,
    }))
    .sort(
      (a, b) =>
        a.system.localeCompare(b.system) ||
        a.code.localeCompare(b.code, undefined, { numeric: true })
    );
}

function summarizeCostRows(rows, targetFgk) {
  const elements = new Set(rows.map((row) => row.elementId));
  const quantityElements = new Set(
    rows.filter((row) => !row.fallback).map((row) => row.elementId)
  );
  const classifiedElements = new Set(
    rows.filter((row) => row.classification).map((row) => row.elementId)
  );
  const costGroupElements = new Set(
    rows.filter((row) => row.costGroup).map((row) => row.elementId)
  );
  const mappedCostGroupElements = new Set(
    rows
      .filter((row) => row.costGroupMappingId)
      .map((row) => row.elementId)
  );
  const unmappedClassificationElements = new Set(
    rows
      .filter((row) => row.classification && !row.costGroup)
      .map((row) => row.elementId)
  );
  const fgkElements = new Set(rows.filter((row) => row.fgk).map((row) => row.elementId));
  const readyRows = rows.filter((row) => getReadiness(row, targetFgk).level === "ready");
  const classificationSystems = Array.from(
    new Set(rows.map((row) => row.classificationSystem).filter(Boolean))
  ).sort();

  return {
    rows: rows.length,
    elements: elements.size,
    quantityElements: quantityElements.size,
    classifiedElements: classifiedElements.size,
    costGroupElements: costGroupElements.size,
    mappedCostGroupElements: mappedCostGroupElements.size,
    unmappedClassificationElements: unmappedClassificationElements.size,
    classificationSystems,
    fgkElements: fgkElements.size,
    readyRows: readyRows.length,
    fallbackRows: rows.filter((row) => row.fallback).length,
  };
}

function getReadiness(row, targetFgk) {
  const issues = [];
  if (row.fallback) issues.push("missing explicit quantity");
  if (!row.costGroup && !row.classification) {
    issues.push("missing cost classification");
  } else if (!row.costGroup && row.classification) {
    issues.push("missing DIN 276 mapping");
  }
  if (targetFgk && row.fgk && Number(row.fgk) < Number(targetFgk)) {
    issues.push(`below FGK ${targetFgk}`);
  }

  if (!issues.length) return { level: "ready", label: "Ready" };
  if (
    issues.length === 1 &&
    ["missing cost classification", "missing DIN 276 mapping"].includes(issues[0])
  ) {
    return {
      level: "review",
      label:
        issues[0] === "missing DIN 276 mapping"
          ? "Map classification"
          : "Review classification",
    };
  }
  return { level: "incomplete", label: "Incomplete" };
}

function resolveCostGroup(properties, classifications, mappings) {
  const propertyGroup = extractPropertyCostGroup(properties);
  if (propertyGroup) {
    return {
      costGroup: propertyGroup,
      source: "IFC cost-group property",
      mappingId: "",
    };
  }

  for (const classification of classifications) {
    if (!isDin276System(classification.system)) continue;
    const directGroup = extractDinGroup(classification.code);
    if (directGroup) {
      return {
        costGroup: directGroup,
        source: `DIN 276 classification ${classification.code}`,
        mappingId: "",
      };
    }
  }

  for (const classification of classifications) {
    const key = classificationMappingKey(
      classification.system,
      classification.code
    );
    const mapping = mappings.find(
      (entry) =>
        entry.active &&
        entry.dinGroup &&
        classificationMappingKey(entry.sourceSystem, entry.sourceCode) === key
    );
    if (!mapping) continue;

    return {
      costGroup: mapping.dinGroup,
      source: `Mapped from ${classification.system} ${classification.code}`,
      mappingId: mapping.id,
    };
  }

  return { costGroup: "", source: "", mappingId: "" };
}

function extractPropertyCostGroup(properties) {
  const hit = properties.find((property) => {
    const key = normalize(`${property.psetName} ${property.name}`);
    return (
      key.includes("kostengruppe") ||
      key.includes("kosten gruppe") ||
      key.includes("din276") ||
      key.includes("din 276") ||
      key.includes("cost group") ||
      key.includes("costgroup")
    );
  });

  if (!hit?.display) return "";
  return extractDinGroup(hit.display) || String(hit.display).trim();
}

function extractDinGroup(value) {
  return String(value || "").match(/\b\d{3}(?:\.\d+)?\b/)?.[0] || "";
}

function isDin276System(system) {
  return normalize(system).replace(/[\s_-]+/g, "").includes("din276");
}

function classificationMappingKey(system, code) {
  return `${normalize(system)}::${normalize(code)}`;
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "classification";
}

function extractFgk(properties) {
  const hit = properties.find((property) => {
    const key = normalize(`${property.psetName} ${property.name}`);
    return key.includes("fgk") || key.includes("fertigstellungsgrad");
  });

  const match = String(hit?.display || "").match(/\d{3}/);
  return match?.[0] || "";
}

function extractModelRate(properties) {
  const hit = properties.find((property) => {
    const key = normalize(`${property.psetName} ${property.name}`);
    return (
      key.includes("einheitspreis") ||
      key.includes("unit cost") ||
      key.includes("unitcost") ||
      key.includes("cost rate") ||
      key.includes("costrate") ||
      key === "rate" ||
      key.endsWith(" preis")
    );
  });

  const value = parseNumber(hit?.display);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseClassification(record, records) {
  if (!record) return null;

  if (record.type === "IFCCLASSIFICATIONREFERENCE") {
    const sourceId = parseRef(record.args[3]);
    const source = records.get(sourceId);
    const code = cleanIfcString(record.args[1]);
    const system =
      cleanIfcString(source?.args?.[3]) ||
      cleanIfcString(record.args[2]) ||
      cleanIfcString(source?.args?.[0]) ||
      "Classification";
    const name =
      cleanIfcString(record.args[4]) ||
      cleanIfcString(record.args[2]) ||
      code;
    const classification = {
      id: record.id,
      system,
      code,
      name,
      location: cleanIfcString(record.args[0]),
    };
    return {
      ...classification,
      display: formatClassification(classification),
    };
  }

  if (record.type === "IFCCLASSIFICATION") {
    const classification = {
      id: record.id,
      system:
        cleanIfcString(record.args[3]) ||
        cleanIfcString(record.args[0]) ||
        "Classification",
      code: "",
      name: cleanIfcString(record.args[3]) || cleanIfcString(record.args[0]),
      location: cleanIfcString(record.args[5]),
    };
    return {
      ...classification,
      display: formatClassification(classification),
    };
  }

  return null;
}

function formatClassification(classification) {
  const identity = [classification.system, classification.code]
    .filter(Boolean)
    .join(" ");
  return [identity, classification.name]
    .filter(Boolean)
    .join(" - ");
}

function isCostElement(record) {
  return Boolean(record && COST_ELEMENT_TYPES.has(record.type));
}

function splitTopLevel(input) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === "'") {
      current += char;
      if (inString && next === "'") {
        current += next;
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.length > 0) parts.push(current.trim());
  return parts;
}

function parseRef(value) {
  const match = String(value || "").match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseRefList(value) {
  return Array.from(String(value || "").matchAll(/#(\d+)/g), (match) =>
    Number(match[1])
  );
}

function cleanIfcString(value) {
  const text = String(value || "").trim();
  if (!text || text === "$" || text === "*") return "";
  const unquoted = text.startsWith("'")
    ? text.slice(1, -1).replace(/''/g, "'")
    : text;
  return decodeIfcText(unquoted);
}

function decodeIfcText(value) {
  return String(value || "")
    .replace(/\\X4\\([0-9A-F]+)\\X0\\/gi, (_, hex) =>
      (hex.match(/.{8}/g) || [])
        .map((chunk) => String.fromCodePoint(Number.parseInt(chunk, 16)))
        .join("")
    )
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, hex) =>
      (hex.match(/.{4}/g) || [])
        .map((chunk) => String.fromCodePoint(Number.parseInt(chunk, 16)))
        .join("")
    )
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    );
}

function parseNominalValue(value) {
  const text = String(value || "$").trim();
  if (text === "$") return { display: "", value: "", wrapper: "$" };

  const typed = text.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (typed) {
    const display = cleanIfcString(typed[2]);
    return {
      display,
      value: display,
      wrapper: typed[1].toUpperCase(),
    };
  }

  const display = cleanIfcString(text);
  return {
    display,
    value: display,
    wrapper: "",
  };
}

function parseNumber(value) {
  const text = String(value || "").trim();
  const typed = text.match(/^[A-Z0-9_]+\(([\s\S]*)\)$/i);
  const raw = typed ? typed[1] : text;
  const match = String(raw).replace(",", ".").match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i);
  return match ? Number(match[0]) : NaN;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
