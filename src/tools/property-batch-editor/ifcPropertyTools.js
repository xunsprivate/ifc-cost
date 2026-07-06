const LINE_PATTERN = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*;?$/i;

export function parseIfcLines(text) {
  const lines = text.split(/\r?\n/);
  const records = new Map();

  lines.forEach((line, index) => {
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

  return { lines, records };
}

export function buildPropertyRows(text) {
  const { records } = parseIfcLines(text);
  const propertySets = new Map();

  for (const record of records.values()) {
    if (record.type !== "IFCPROPERTYSET") continue;

    propertySets.set(record.id, {
      id: record.id,
      name: cleanIfcString(record.args[2]),
      propertyIds: parseRefList(record.args[4]),
    });
  }

  const rows = [];

  for (const record of records.values()) {
    if (record.type !== "IFCRELDEFINESBYPROPERTIES") continue;

    const relatedElementIds = parseRefList(record.args[4]);
    const propertySetId = parseRef(record.args[5]);
    const propertySet = propertySets.get(propertySetId);
    if (!propertySet) continue;

    relatedElementIds.forEach((elementId) => {
      const element = records.get(elementId);
      if (!element || !element.type.startsWith("IFC")) return;

      propertySet.propertyIds.forEach((propertyId) => {
        const property = records.get(propertyId);
        if (!property || property.type !== "IFCPROPERTYSINGLEVALUE") return;

        const value = parseNominalValue(property.args[2]);
        rows.push({
          rowId: `${elementId}-${propertySetId}-${propertyId}`,
          elementId,
          elementType: element.type,
          elementGlobalId: cleanIfcString(element.args[0]),
          elementName: cleanIfcString(element.args[2]),
          propertySetId,
          propertySetName: propertySet.name || `#${propertySetId}`,
          propertyId,
          propertyName: cleanIfcString(property.args[0]) || `#${propertyId}`,
          propertyValue: value.display,
          propertyValueType: value.wrapper,
          rawValue: property.args[2] || "$",
        });
      });
    });
  }

  return rows.sort((a, b) => {
    return (
      a.elementType.localeCompare(b.elementType) ||
      a.elementId - b.elementId ||
      a.propertySetName.localeCompare(b.propertySetName) ||
      a.propertyName.localeCompare(b.propertyName)
    );
  });
}

export function updateSingleValueProperties(text, propertyIds, nextValue) {
  const ids = new Set(propertyIds.map(Number));
  const { lines, records } = parseIfcLines(text);
  let updatedCount = 0;

  ids.forEach((id) => {
    const record = records.get(id);
    if (!record || record.type !== "IFCPROPERTYSINGLEVALUE") return;

    const args = [...record.args];
    args[2] = formatNominalValue(args[2], nextValue);
    lines[record.lineIndex] = `#${record.id}= ${record.type}(${args.join(",")});`;
    updatedCount += 1;
  });

  return {
    text: lines.join("\n"),
    updatedCount,
  };
}

export function filterPropertyRows(rows, filters) {
  const search = normalize(filters.search);
  const entity = normalize(filters.entityType);
  const pset = normalize(filters.propertySet);
  const prop = normalize(filters.propertyName);
  const value = normalize(filters.currentValue);

  return rows.filter((row) => {
    const searchable = normalize(
      [
        row.elementId,
        row.elementType,
        row.elementGlobalId,
        row.elementName,
        row.propertySetName,
        row.propertyName,
        row.propertyValue,
      ].join(" ")
    );

    return (
      (!search || searchable.includes(search)) &&
      (!entity || normalize(row.elementType).includes(entity)) &&
      (!pset || normalize(row.propertySetName).includes(pset)) &&
      (!prop || normalize(row.propertyName).includes(prop)) &&
      (!value || normalize(row.propertyValue).includes(value))
    );
  });
}

export function summarizeRows(rows) {
  return {
    rows: rows.length,
    elements: new Set(rows.map((row) => row.elementId)).size,
    properties: new Set(rows.map((row) => row.propertyId)).size,
  };
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
  if (!text || text === "$") return "";
  if (!text.startsWith("'")) return text;
  return text.slice(1, -1).replace(/''/g, "'");
}

function parseNominalValue(value) {
  const text = String(value || "$").trim();
  if (text === "$") return { display: "", wrapper: "$" };

  const typed = text.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (typed) {
    return {
      display: cleanIfcString(typed[2]),
      wrapper: typed[1].toUpperCase(),
    };
  }

  return {
    display: cleanIfcString(text),
    wrapper: "",
  };
}

function formatNominalValue(previousValue, nextValue) {
  const previous = String(previousValue || "$").trim();
  const escapedValue = String(nextValue ?? "").replace(/'/g, "''");

  if (previous === "$") return `IFCLABEL('${escapedValue}')`;

  const typed = previous.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (typed) return `${typed[1].toUpperCase()}('${escapedValue}')`;

  return `'${escapedValue}'`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}
