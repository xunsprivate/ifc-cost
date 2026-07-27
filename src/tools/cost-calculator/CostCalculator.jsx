import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calculator,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  GitCompareArrows,
  Layers,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import IfcViewerComponent from "../../IfcViewer";
import {
  applyClassificationMappings,
  applyCostRules,
  buildCostAnalysis,
  buildCostBreakdown,
  buildCostSnapshot,
  compareCostSnapshots,
  createDefaultClassificationMappings,
  createDefaultRateLibrary,
  exportCostComparisonCsv,
  exportCostRowsCsv,
  filterCostRows,
  getRowRate,
  getRowRateSource,
  mergeClassificationMappings,
  normalizeClassificationMappings,
  normalizeRateLibrary,
  summarizeCosts,
} from "./ifcCostTools";
import "./cost-calculator.css";

const sampleIfcUrl = new URL("../../../sample.ifc", import.meta.url).href;
const RATE_LIBRARY_STORAGE_KEY = "ifc-cost-rate-library-v1";
const CLASSIFICATION_MAPPING_STORAGE_KEY = "ifc-cost-classification-mappings-v1";
const RATE_LIBRARY_MIGRATION_IDS = new Set([
  "stair-count-fallback",
  "railing-count-fallback",
]);

const emptyFilters = {
  search: "",
  level: "",
  entityType: "",
  unit: "",
  costGroup: "",
  quantityName: "",
  pricingStatus: "",
  readiness: "",
};

function CostCalculator() {
  const fileInputRef = useRef(null);
  const baselineInputRef = useRef(null);
  const targetInputRef = useRef(null);
  const rateLibraryInputRef = useRef(null);
  const classificationMappingInputRef = useRef(null);
  const [mode, setMode] = useState("estimate");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [fileContent, setFileContent] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [targetFgk, setTargetFgk] = useState("300");
  const [rowRates, setRowRates] = useState({});
  const [basisOverrides, setBasisOverrides] = useState({});
  const [rateLibrary, setRateLibrary] = useState(readRateLibrary);
  const [classificationMappings, setClassificationMappings] = useState(readClassificationMappings);
  const [groupBy, setGroupBy] = useState("level");
  const [bulkRate, setBulkRate] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [compareFiles, setCompareFiles] = useState({
    baseline: null,
    target: null,
  });
  const [compareSearch, setCompareSearch] = useState("");
  const [compareStatus, setCompareStatus] = useState("all");
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [isViewerLoading, setIsViewerLoading] = useState(false);
  const [viewerMessage, setViewerMessage] = useState("");
  const [expandedPanels, setExpandedPanels] = useState({
    filters: true,
    breakdown: false,
    model: true,
    element: true,
    workItems: true,
  });

  useEffect(() => {
    try {
      localStorage.setItem(RATE_LIBRARY_STORAGE_KEY, JSON.stringify(rateLibrary));
    } catch {
      // The calculator remains usable when browser storage is unavailable.
    }
  }, [rateLibrary]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CLASSIFICATION_MAPPING_STORAGE_KEY,
        JSON.stringify(classificationMappings)
      );
    } catch {
      // The calculator remains usable when browser storage is unavailable.
    }
  }, [classificationMappings]);

  const parsedAnalysis = useMemo(
    () => buildCostAnalysis(rawText, targetFgk, []),
    [rawText, targetFgk]
  );
  const analysis = useMemo(
    () =>
      applyClassificationMappings(
        parsedAnalysis,
        classificationMappings,
        targetFgk
      ),
    [parsedAnalysis, classificationMappings, targetFgk]
  );

  const pricedRows = useMemo(
    () => applyCostRules(analysis.rows, rateLibrary, basisOverrides),
    [analysis.rows, rateLibrary, basisOverrides]
  );
  const filteredRows = useMemo(
    () => filterCostRows(pricedRows, filters, rowRates),
    [pricedRows, filters, rowRates]
  );
  const filterOptions = useMemo(
    () => buildFilterOptions(pricedRows),
    [pricedRows]
  );
  const visibleElementIds = useMemo(
    () => Array.from(new Set(filteredRows.map((row) => row.elementId))),
    [filteredRows]
  );
  const isFilterActive = Object.values(filters).some(
    (value) => String(value).trim() !== ""
  );
  const activeFilterCount = Object.values(filters).filter(
    (value) => String(value).trim() !== ""
  ).length;
  const selectedRows = useMemo(
    () => pricedRows.filter((row) => row.elementId === selectedElementId),
    [pricedRows, selectedElementId]
  );
  const selectedElement = selectedRows[0] || null;
  const visibleSummary = useMemo(
    () => summarizeCosts(filteredRows, rowRates),
    [filteredRows, rowRates]
  );
  const fullSummary = useMemo(
    () => summarizeCosts(pricedRows, rowRates),
    [pricedRows, rowRates]
  );
  const costBreakdown = useMemo(
    () => buildCostBreakdown(filteredRows, rowRates, groupBy),
    [filteredRows, rowRates, groupBy]
  );
  const activeRateCount = rateLibrary.filter((entry) => entry.active).length;
  const completedMappingCount = classificationMappings.filter(
    (entry) => entry.active && entry.dinGroup
  ).length;
  const discoveredClassificationCount = analysis.classificationCatalog.length;
  const comparison = useMemo(() => {
    if (!compareFiles.baseline?.text || !compareFiles.target?.text) return null;

    const baseline = buildCostSnapshot({
      name: compareFiles.baseline.name,
      text: compareFiles.baseline.text,
      targetFgk,
      rateLibrary,
      classificationMappings,
    });
    const target = buildCostSnapshot({
      name: compareFiles.target.name,
      text: compareFiles.target.text,
      targetFgk,
      rateLibrary,
      classificationMappings,
    });

    return compareCostSnapshots(baseline, target);
  }, [compareFiles, targetFgk, rateLibrary, classificationMappings]);

  const visibleChanges = useMemo(() => {
    if (!comparison) return [];

    const rows = [
      ...comparison.added.map((element) => ({ status: "added", element })),
      ...comparison.deleted.map((element) => ({ status: "deleted", element })),
      ...comparison.modified.map((element) => ({ status: "modified", element })),
    ];
    const query = compareSearch.trim().toLowerCase();

    return rows.filter((row) => {
      const element = row.element;
      const text = [
        row.status,
        element.unique_id,
        element.element_id,
        element.category,
        element.family,
        element.type,
        element.level,
        element.workset,
        ...(element.changes || []).map((change) => change.property),
      ]
        .join(" ")
        .toLowerCase();

      return (
        (compareStatus === "all" || row.status === compareStatus) &&
        (!query || text.includes(query))
      );
    });
  }, [comparison, compareSearch, compareStatus]);

  const processFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      setMessage("Upload an .ifc file.");
      return;
    }

    const [text, arrayBuffer] = await Promise.all([
      file.text(),
      file.arrayBuffer(),
    ]);
    const nextAnalysis = buildCostAnalysis(text, targetFgk, classificationMappings);
    const nextPricedRows = applyCostRules(nextAnalysis.rows, rateLibrary, {});
    setClassificationMappings((current) =>
      mergeClassificationMappings(current, nextAnalysis.classificationCatalog)
    );

    setFileName(file.name);
    setRawText(text);
    setFileContent(arrayBuffer);
    setFilters(emptyFilters);
    setRowRates({});
    setBasisOverrides({});
    setBulkRate("");
    setSelectedElementId(null);
    setViewerMessage("");
    setMessage(
      `Loaded ${nextPricedRows.length} priced work items from ${nextAnalysis.summary.elements} elements; ${nextAnalysis.summary.rows} IFC quantity candidates evaluated.`
    );
  };

  const processCompareFile = async (slot, file) => {
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      setMessage("Upload an .ifc file.");
      return;
    }

    const text = await file.text();
    setCompareFiles((current) => ({
      ...current,
      [slot]: { name: file.name, text },
    }));
    setMessage(`${slot === "baseline" ? "Baseline" : "Target"} snapshot loaded.`);
  };

  const loadSample = async () => {
    try {
      const response = await fetch(sampleIfcUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const arrayBuffer = await response.arrayBuffer();
      const text = new TextDecoder("utf-8").decode(arrayBuffer);
      const nextAnalysis = buildCostAnalysis(text, targetFgk, classificationMappings);
      const nextPricedRows = applyCostRules(nextAnalysis.rows, rateLibrary, {});
      setFileName("sample.ifc");
      setRawText(text);
      setFileContent(arrayBuffer);
      setFilters(emptyFilters);
      setRowRates({});
      setBasisOverrides({});
      setBulkRate("");
      setSelectedElementId(null);
      setViewerMessage("");
      setMessage(
        `Loaded sample.ifc with ${nextPricedRows.length} priced work items from ${nextAnalysis.summary.rows} quantity candidates.`
      );
    } catch (error) {
      setMessage(`Could not load sample.ifc: ${error.message || error}`);
    }
  };

  const loadSampleForCompare = async (slot) => {
    try {
      const response = await fetch(sampleIfcUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      setCompareFiles((current) => ({
        ...current,
        [slot]: { name: `sample-${slot}.ifc`, text },
      }));
      setMessage(`${slot === "baseline" ? "Baseline" : "Target"} sample loaded.`);
    } catch (error) {
      setMessage(`Could not load sample.ifc: ${error.message || error}`);
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && mode === "estimate") processFile(file);
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedElementId(null);
  };

  const togglePanel = (panel) => {
    setExpandedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
    if (panel === "model" && !expandedPanels.model) {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setSelectedElementId(null);
  };

  const updateRowRate = (rowId, value) => {
    setRowRates((current) => ({ ...current, [rowId]: value }));
  };

  const updateBasisOverride = (elementId, rowId) => {
    setBasisOverrides((current) => ({ ...current, [elementId]: rowId }));
    setSelectedElementId(elementId);
  };

  const updateRateRule = (id, key, value) => {
    setRateLibrary((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              [key]: key === "rate" ? Math.max(0, Number(value) || 0) : value,
            }
          : entry
      )
    );
  };

  const addRateRule = () => {
    setRateLibrary((current) => [
      ...current,
      {
        id: createRateRuleId(),
        label: "New rate",
        elementType: "IFCWALL",
        costGroup: "",
        unit: "m2",
        quantityName: "NetSideArea",
        rate: 0,
        active: true,
      },
    ]);
  };

  const removeRateRule = (id) => {
    setRateLibrary((current) => current.filter((entry) => entry.id !== id));
  };

  const resetRateLibrary = () => {
    if (!window.confirm("Reset the rate library to the built-in defaults?")) return;
    setRateLibrary(createDefaultRateLibrary());
    setMessage("Rate library reset to defaults.");
  };

  const exportRateLibrary = () => {
    downloadJson(rateLibrary, "ifc_cost_rate_library.json");
    setMessage(`Exported ${rateLibrary.length} rate rules.`);
  };

  const importRateLibrary = async (file) => {
    try {
      const imported = normalizeRateLibrary(JSON.parse(await file.text()));
      if (!imported.length) throw new Error("No valid rate rules found");
      setRateLibrary(imported);
      setMessage(`Imported ${imported.length} rate rules.`);
    } catch (error) {
      setMessage(`Could not import rate library: ${error.message || error}`);
    }
  };

  const updateClassificationMapping = (id, key, value) => {
    setClassificationMappings((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, [key]: value } : entry
      )
    );
  };

  const addClassificationMapping = () => {
    setClassificationMappings((current) => [
      ...current,
      {
        id: createClassificationMappingId(),
        sourceSystem: "Uniformat",
        sourceCode: "",
        label: "New classification mapping",
        dinGroup: "",
        active: true,
      },
    ]);
  };

  const removeClassificationMapping = (id) => {
    setClassificationMappings((current) =>
      current.filter((entry) => entry.id !== id)
    );
  };

  const resetClassificationMappings = () => {
    if (!window.confirm("Reset classification mappings to the built-in defaults?")) return;
    setClassificationMappings(createDefaultClassificationMappings());
    setMessage("Classification mappings reset to defaults.");
  };

  const exportClassificationMappings = () => {
    downloadJson(
      classificationMappings,
      "ifc_uniformat_to_din276_mappings.json"
    );
    setMessage(`Exported ${classificationMappings.length} classification mappings.`);
  };

  const importClassificationMappings = async (file) => {
    try {
      const imported = normalizeClassificationMappings(
        JSON.parse(await file.text())
      );
      if (!imported.length) throw new Error("No valid classification mappings found");
      setClassificationMappings(imported);
      setMessage(`Imported ${imported.length} classification mappings.`);
    } catch (error) {
      setMessage(`Could not import classification mappings: ${error.message || error}`);
    }
  };

  const applyBreakdownFilter = (group) => {
    const filterKey = {
      level: "level",
      costGroup: "costGroup",
      elementType: "entityType",
    }[groupBy];
    if (!filterKey || (groupBy === "costGroup" && !group.value)) return;
    updateFilter(filterKey, group.value);
  };

  const applyBulkRate = () => {
    const rate = Number(bulkRate);
    if (!Number.isFinite(rate) || rate < 0 || !filteredRows.length) return;

    setRowRates((current) => {
      const next = { ...current };
      filteredRows.forEach((row) => {
        next[row.rowId] = String(rate);
      });
      return next;
    });
    setMessage(`Applied ${formatCurrency(rate)} per unit to ${filteredRows.length} filtered work items.`);
  };

  const exportCsv = () => {
    if (!filteredRows.length) return;

    const csv = exportCostRowsCsv(filteredRows, rowRates);
    const scope = isFilterActive ? "filtered" : "full";
    downloadCsv(
      csv,
      `cost_${scope}_${stripExtension(fileName) || "model"}.csv`
    );
    setMessage(
      `Exported ${filteredRows.length} filtered work items from ${visibleElementIds.length} elements.`
    );
  };

  const exportComparisonCsv = () => {
    if (!comparison) return;

    downloadCsv(
      exportCostComparisonCsv(comparison),
      `ifc_cost_change_${stripExtension(compareFiles.target?.name) || "target"}.csv`
    );
  };

  return (
    <main
      className="cost-calculator"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
    >
      <section className="cost-toolbar">
        <div>
          <p className="cost-eyebrow">IFC cost planning</p>
          <h1>
            {mode === "estimate"
              ? "Rule-Based IFC Cost Calculator"
              : mode === "rates"
                ? "Reusable Rate Library"
                : mode === "mappings"
                  ? "Uniformat to DIN 276 Mapping"
                  : "IFC Cost Change Tracker"}
          </h1>
        </div>
        <div className="cost-toolbar-actions">
          <div className="cost-mode-toggle" aria-label="Cost calculator mode">
            <button
              type="button"
              className={mode === "estimate" ? "active" : ""}
              onClick={() => setMode("estimate")}
            >
              <Calculator size={16} />
              Estimate
            </button>
            <button
              type="button"
              className={mode === "rates" ? "active" : ""}
              onClick={() => setMode("rates")}
            >
              <BookOpen size={16} />
              Rates
            </button>
            <button
              type="button"
              className={mode === "mappings" ? "active" : ""}
              onClick={() => setMode("mappings")}
            >
              <Layers size={16} />
              Mappings
            </button>
            <button
              type="button"
              className={mode === "compare" ? "active" : ""}
              onClick={() => setMode("compare")}
            >
              <GitCompareArrows size={16} />
              Compare
            </button>
          </div>
          {(mode === "estimate" || mode === "compare") && (
            <label>
              Target FGK
              <select
                value={targetFgk}
                onChange={(event) => setTargetFgk(event.target.value)}
              >
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="300">300</option>
                <option value="400">400</option>
                <option value="500">500</option>
              </select>
            </label>
          )}
          {mode === "estimate" ? (
            <>
              <button type="button" onClick={loadSample}>
                <FileSpreadsheet size={18} />
                Sample
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <UploadCloud size={18} />
                Upload IFC
              </button>
              <button type="button" onClick={exportCsv} disabled={!filteredRows.length}>
                <Download size={18} />
                CSV
              </button>
            </>
          ) : mode === "rates" ? (
            <>
              <button type="button" onClick={addRateRule}>
                <Plus size={18} />
                Add rate
              </button>
              <button type="button" onClick={() => rateLibraryInputRef.current?.click()}>
                <UploadCloud size={18} />
                Import JSON
              </button>
              <button type="button" onClick={exportRateLibrary} disabled={!rateLibrary.length}>
                <Download size={18} />
                Export JSON
              </button>
              <button type="button" onClick={resetRateLibrary}>
                <RotateCcw size={18} />
                Defaults
              </button>
            </>
          ) : mode === "mappings" ? (
            <>
              <button type="button" onClick={addClassificationMapping}>
                <Plus size={18} />
                Add mapping
              </button>
              <button
                type="button"
                onClick={() => classificationMappingInputRef.current?.click()}
              >
                <UploadCloud size={18} />
                Import JSON
              </button>
              <button
                type="button"
                onClick={exportClassificationMappings}
                disabled={!classificationMappings.length}
              >
                <Download size={18} />
                Export JSON
              </button>
              <button type="button" onClick={resetClassificationMappings}>
                <RotateCcw size={18} />
                Defaults
              </button>
            </>
          ) : (
            <button type="button" onClick={exportComparisonCsv} disabled={!comparison}>
              <Download size={18} />
              Change CSV
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ifc"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) processFile(file);
              event.target.value = "";
            }}
          />
          <input
            ref={baselineInputRef}
            type="file"
            accept=".ifc"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) processCompareFile("baseline", file);
              event.target.value = "";
            }}
          />
          <input
            ref={targetInputRef}
            type="file"
            accept=".ifc"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) processCompareFile("target", file);
              event.target.value = "";
            }}
          />
          <input
            ref={rateLibraryInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importRateLibrary(file);
              event.target.value = "";
            }}
          />
          <input
            ref={classificationMappingInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importClassificationMappings(file);
              event.target.value = "";
            }}
          />
        </div>
      </section>

      {mode === "estimate"
        ? renderEstimate()
        : mode === "rates"
          ? renderRateLibrary()
          : mode === "mappings"
            ? renderClassificationMappings()
            : renderCompare()}
    </main>
  );

  function renderEstimate() {
    if (!rawText) {
      return (
        <section className={`cost-drop-zone ${isDragging ? "is-dragging" : ""}`}>
          <Calculator size={48} />
          <h2>Drop an IFC file to calculate model-based costs</h2>
          <p>
            The calculator extracts IFC quantity sets, reads cost classification
            and FGK properties when present, and keeps every cost line traceable
            to the source element.
          </p>
          <button type="button" onClick={loadSample}>
            Open sample.ifc
          </button>
        </section>
      );
    }

    const selectedRate = selectedElement
      ? getRowRate(selectedElement, rowRates)
      : 0;
    const selectedRateSource = selectedElement
      ? getRowRateSource(selectedElement, rowRates)
      : "";
    const selectedTotal = selectedElement
      ? selectedElement.quantityValue * selectedRate
      : 0;

    return (
      <section
        className={`cost-workspace ${expandedPanels.filters ? "" : "filters-collapsed"}`}
      >
        <aside
          className={`cost-filter-panel ${expandedPanels.filters ? "" : "is-collapsed"}`}
        >
          <div className="cost-panel-heading">
            <div className="cost-panel-title">
              <Filter size={18} />
              <h2>Filters</h2>
              {activeFilterCount > 0 && (
                <span className="filter-count">{activeFilterCount}</span>
              )}
            </div>
            <div className="cost-panel-actions">
              {expandedPanels.filters && (
                <button
                  type="button"
                  className="clear-filter-button"
                  onClick={clearFilters}
                  disabled={!activeFilterCount}
                >
                  <RotateCcw size={14} />
                  Clear
                </button>
              )}
              <PanelToggle
                expanded={expandedPanels.filters}
                onToggle={() => togglePanel("filters")}
                label="filters"
              />
            </div>
          </div>

          {expandedPanels.filters && (
            <div className="cost-filter-content">
              <label>
            Search
            <div className="cost-input-with-icon">
              <Search size={16} />
              <input
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Element, QTO, cost group"
              />
            </div>
              </label>
              <label>
            Building level
            <select
              value={filters.level}
              onChange={(event) => updateFilter("level", event.target.value)}
            >
              <option value="">All levels</option>
              {filterOptions.levels.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
              </label>
              <label>
            IFC class
            <select
              value={filters.entityType}
              onChange={(event) => updateFilter("entityType", event.target.value)}
            >
              <option value="">All IFC classes</option>
              {filterOptions.entityTypes.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
              </label>
              <label>
            Cost group
            <select
              value={filters.costGroup}
              onChange={(event) => updateFilter("costGroup", event.target.value)}
            >
              <option value="">All cost groups</option>
              {filterOptions.costGroups.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
              </label>
              <label>
            Quantity
            <select
              value={filters.quantityName}
              onChange={(event) => updateFilter("quantityName", event.target.value)}
            >
              <option value="">All quantities</option>
              {filterOptions.quantityNames.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
              </label>
              <label>
            Unit
            <select
              value={filters.unit}
              onChange={(event) => updateFilter("unit", event.target.value)}
            >
              <option value="">All units</option>
              {filterOptions.units.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
              </label>
              <label>
            Pricing status
            <select
              value={filters.pricingStatus}
              onChange={(event) => updateFilter("pricingStatus", event.target.value)}
            >
              <option value="">All pricing statuses</option>
              <option value="priced">Priced</option>
              <option value="unpriced">Needs rate</option>
            </select>
              </label>
              <label>
            Readiness
            <select
              value={filters.readiness}
              onChange={(event) => updateFilter("readiness", event.target.value)}
            >
              <option value="">All work items</option>
              <option value="ready">Ready</option>
              <option value="review">Review</option>
              <option value="incomplete">Incomplete</option>
            </select>
              </label>

              <div className="cost-kpi-grid">
            <span>
              <strong>{analysis.summary.elements}</strong>
              model elements
            </span>
            <span>
              <strong>{pricedRows.length}</strong>
              priced work items
            </span>
            <span>
              <strong>{fullSummary.excludedQuantities}</strong>
              quantities excluded
            </span>
            <button
              type="button"
              className={filters.pricingStatus === "unpriced" ? "is-active" : ""}
              onClick={() =>
                updateFilter(
                  "pricingStatus",
                  filters.pricingStatus === "unpriced" ? "" : "unpriced"
                )
              }
              aria-pressed={filters.pricingStatus === "unpriced"}
              disabled={
                fullSummary.unpriced === 0 &&
                filters.pricingStatus !== "unpriced"
              }
              title="Show only work items that need a rate"
            >
              <strong>{fullSummary.unpriced}</strong>
              need a rate
            </button>
            <span>
              <strong>{analysis.summary.costGroupElements}</strong>
              DIN-mapped elements
            </span>
            <span>
              <strong>{analysis.summary.unmappedClassificationElements}</strong>
              classifications to map
            </span>
              </div>

              <button
            type="button"
            className="manage-rate-library-button"
            onClick={() => setMode("rates")}
          >
            <BookOpen size={16} />
            Manage {activeRateCount} active rate rules
              </button>
              <button
            type="button"
            className="manage-rate-library-button"
            onClick={() => setMode("mappings")}
          >
            <Layers size={16} />
            Manage {completedMappingCount} DIN 276 mappings
              </button>

              <div className="bulk-rate-panel">
                <label>
              Unit rate for filtered work items
              <input
                value={bulkRate}
                onChange={(event) => setBulkRate(event.target.value)}
                inputMode="decimal"
                placeholder="EUR per unit"
              />
                </label>
                <button
              type="button"
              onClick={applyBulkRate}
              disabled={!filteredRows.length || bulkRate === ""}
            >
              Apply to filtered
                </button>
              </div>
            </div>
          )}
        </aside>

        <section className="cost-results-panel">
          <div className="cost-results-header">
            <div>
              <p className="cost-file-name">{fileName}</p>
              <h2>{formatCurrency(fullSummary.total)} total estimate</h2>
            </div>
            <div className="cost-total-strip">
              <span>
                <strong>{formatCurrency(visibleSummary.total)}</strong>
                filtered total
              </span>
              <span>
                <strong>{visibleSummary.items}</strong>
                work items
              </span>
              <span>
                <strong>{visibleSummary.elements.size}</strong>
                elements
              </span>
            </div>
          </div>

          {message && <p className="cost-status-message">{message}</p>}

          <div className="cost-rule-notice">
            <BarChart3 size={18} />
            <span>
              <strong>One pricing basis per element.</strong>
              {` ${pricedRows.length} work items selected; ${fullSummary.excludedQuantities} alternative IFC quantity rows excluded from totals.`}
            </span>
          </div>

          {(fullSummary.unpriced > 0 ||
            analysis.summary.fallbackRows > 0 ||
            analysis.summary.classifiedElements < analysis.summary.elements) && (
            <div className="cost-warning">
              <AlertTriangle size={18} />
              <span>
                {fullSummary.unpriced > 0
                  ? `${fullSummary.unpriced} work item${fullSummary.unpriced === 1 ? " needs" : "s need"} a matching rate rule or manual rate.`
                  : "Some elements still need quantity or classification review."}
              </span>
            </div>
          )}

          <section
            className={`cost-dashboard ${expandedPanels.breakdown ? "" : "is-collapsed"}`}
            aria-label="Grouped cost dashboard"
          >
            <div className="cost-dashboard-heading">
              <div>
                <BarChart3 size={18} />
                <div>
                  <strong>Filtered cost breakdown</strong>
                  <small>Click a group to apply it as a filter.</small>
                </div>
              </div>
              <div className="cost-panel-actions">
                {expandedPanels.breakdown && (
                  <div className="cost-dashboard-tabs" aria-label="Group costs by">
                    <button
                      type="button"
                      className={groupBy === "level" ? "active" : ""}
                      onClick={() => setGroupBy("level")}
                    >
                      Level
                    </button>
                    <button
                      type="button"
                      className={groupBy === "costGroup" ? "active" : ""}
                      onClick={() => setGroupBy("costGroup")}
                    >
                      Cost group
                    </button>
                    <button
                      type="button"
                      className={groupBy === "elementType" ? "active" : ""}
                      onClick={() => setGroupBy("elementType")}
                    >
                      IFC class
                    </button>
                  </div>
                )}
                <PanelToggle
                  expanded={expandedPanels.breakdown}
                  onToggle={() => togglePanel("breakdown")}
                  label="cost breakdown"
                />
              </div>
            </div>
            {expandedPanels.breakdown && (
              <div className="cost-breakdown-list">
                {costBreakdown.slice(0, 8).map((group) => (
                  <button
                    type="button"
                    className="cost-breakdown-row"
                    key={`${groupBy}-${group.value || "unclassified"}`}
                    onClick={() => applyBreakdownFilter(group)}
                    disabled={groupBy === "costGroup" && !group.value}
                  >
                    <span className="cost-breakdown-label">
                      <strong>{group.label}</strong>
                      <small>{group.elementCount} element{group.elementCount === 1 ? "" : "s"}</small>
                    </span>
                    <span className="cost-breakdown-track">
                      <span style={{ width: `${Math.max(2, group.share * 100)}%` }} />
                    </span>
                    <span className="cost-breakdown-value">
                      <strong>{formatCurrency(group.total)}</strong>
                      <small>{formatPercent(group.share)}</small>
                    </span>
                  </button>
                ))}
                {!costBreakdown.length && <p>No priced work items match the filters.</p>}
              </div>
            )}
          </section>

          <section
            className={`cost-model-panel ${expandedPanels.model ? "" : "is-collapsed"}`}
            aria-label="Filtered IFC model"
          >
            <div className="cost-model-heading">
              <div>
                <Layers size={18} />
                <div>
                  <strong>IFC model + cost view</strong>
                  <small>
                    Filters control both the model visibility and the cost work items.
                    Click a model element or table row to connect them.
                  </small>
                </div>
              </div>
              <div className="cost-panel-actions">
                {expandedPanels.model && (
                  <div className="cost-model-stats">
                    <span>
                      <Eye size={15} />
                      {isFilterActive
                        ? `${visibleElementIds.length} filtered elements`
                        : "Full model"}
                    </span>
                    {selectedElementId !== null && (
                      <span>Selected #{selectedElementId}</span>
                    )}
                  </div>
                )}
                <PanelToggle
                  expanded={expandedPanels.model}
                  onToggle={() => togglePanel("model")}
                  label="IFC model"
                />
              </div>
            </div>

            <div className="cost-viewer-canvas">
                <IfcViewerComponent
                  fileContent={fileContent}
                  visibleElementIds={visibleElementIds}
                  isFilterActive={isFilterActive}
                  focusedElementId={selectedElementId}
                  onSelectElement={(props) => {
                    setSelectedElementId(props?.expressID ?? null);
                    if (props?.expressID) {
                      setViewerMessage(`Selected IFC element #${props.expressID}.`);
                    }
                  }}
                  onLoadStart={() => {
                    setIsViewerLoading(true);
                    setViewerMessage("Preparing IFC geometry...");
                  }}
                  onLoadSuccess={() => {
                    setIsViewerLoading(false);
                    setViewerMessage("Model ready. Filters are linked to the cost table.");
                  }}
                  onLoadError={(error) => {
                    setIsViewerLoading(false);
                    setViewerMessage(error);
                  }}
                  onSelectionMiss={() => {
                    setSelectedElementId(null);
                    setViewerMessage("No IFC element found at that position.");
                  }}
                />
                {isViewerLoading && (
                  <div className="cost-viewer-loading">
                    <div className="loader" />
                    <span>Preparing IFC geometry...</span>
                  </div>
                )}
            </div>
          </section>

          <section
            className={`cost-element-editor ${expandedPanels.element ? "" : "is-collapsed"}`}
            aria-label="Selected element editor"
          >
            <div className="cost-element-editor-heading">
              <div>
                <Calculator size={18} />
                <div>
                  <strong>Element editor</strong>
                  <small>Choose a pricing basis and enter the unit rate.</small>
                </div>
              </div>
              <div className="cost-panel-actions">
                {selectedElement && (
                  <span className="selected-element-pill">
                    #{selectedElement.elementId} {selectedElement.elementType}
                  </span>
                )}
                <PanelToggle
                  expanded={expandedPanels.element}
                  onToggle={() => togglePanel("element")}
                  label="element editor"
                />
              </div>
            </div>

            {expandedPanels.element && (
              <div className="cost-element-editor-body">
              {selectedElement ? (
                <>
                    <div className="cost-element-identity">
                      <span>Selected element</span>
                      <strong>
                        #{selectedElement.elementId} {selectedElement.elementType}
                      </strong>
                      <p>{selectedElement.elementName || "Unnamed element"}</p>
                      <small>
                        {selectedElement.level} · {selectedElement.costGroup
                          ? `KG ${selectedElement.costGroup}`
                          : "DIN not mapped"}
                      </small>
                    </div>
                    <label>
                      Pricing basis
                      <select
                        value={selectedElement.rowId}
                        onChange={(event) =>
                          updateBasisOverride(
                            selectedElement.elementId,
                            event.target.value
                          )
                        }
                      >
                        {selectedElement.pricingCandidates.map((candidate) => (
                          <option key={candidate.rowId} value={candidate.rowId}>
                            {candidate.quantityName} — {formatQuantity(candidate.quantityValue)} {candidate.unit}
                          </option>
                        ))}
                      </select>
                      <small>{selectedElement.selectionReason}</small>
                    </label>
                    <label>
                      Unit rate (EUR/{selectedElement.unit})
                      <input
                        value={rowRates[selectedElement.rowId] ?? selectedRate}
                        onChange={(event) =>
                          updateRowRate(selectedElement.rowId, event.target.value)
                        }
                        inputMode="decimal"
                        aria-label={`Selected element unit rate for row ${selectedElement.rowId}`}
                      />
                      <small>{selectedRateSource}</small>
                    </label>
                    <div className="cost-element-total">
                      <span>Element total</span>
                      <strong>{formatCurrency(selectedTotal)}</strong>
                      <small>
                        {formatQuantity(selectedElement.quantityValue)} {selectedElement.unit}
                        {" × "}
                        {formatCurrency(selectedRate)}
                      </small>
                    </div>
                </>
              ) : selectedElementId !== null ? (
                  <div className="cost-element-editor-empty">
                    <strong>#{selectedElementId}</strong>
                    <span>This model element has no cost row in the current analysis.</span>
                  </div>
              ) : (
                  <div className="cost-element-editor-empty">
                    <strong>Select an element</strong>
                    <span>
                      {viewerMessage ||
                        "Choose a model element or a work-item row to edit its cost."}
                    </span>
                  </div>
              )}
              </div>
            )}
          </section>

          <section
            className={`cost-work-items-panel ${expandedPanels.workItems ? "" : "is-collapsed"}`}
            aria-label="Element cost work items"
          >
            <div className="cost-work-items-heading">
              <div>
                <FileSpreadsheet size={18} />
                <div>
                  <strong>Element work items</strong>
                  <small>{filteredRows.length} matching rows · select a row to edit it above</small>
                </div>
              </div>
              <PanelToggle
                expanded={expandedPanels.workItems}
                onToggle={() => togglePanel("workItems")}
                label="element work items"
              />
            </div>

            {expandedPanels.workItems && (
              <div className="cost-table-wrap">
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Element</th>
                  <th>Level</th>
                  <th>Classification</th>
                  <th>Pricing basis</th>
                  <th>Rate</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.slice(0, 800).map((row) => {
                  const rate = getRowRate(row, rowRates);
                  const rateSource = getRowRateSource(row, rowRates);
                  const rowTotal = row.quantityValue * rate;
                  const isPriced = rateSource !== "No matching rate";

                  return (
                    <tr
                      key={row.elementId}
                      className={selectedElementId === row.elementId ? "is-selected" : ""}
                      onClick={() => setSelectedElementId(row.elementId)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedElementId(row.elementId);
                        }
                      }}
                    >
                      <td>
                        <code>#{row.elementId}</code>
                        <span>{row.elementType}</span>
                        <small>{row.elementName || row.elementGlobalId || "-"}</small>
                      </td>
                      <td>
                        <span>{row.level}</span>
                        <small>
                          {row.levelElevation === null
                            ? "Elevation not set"
                            : `${formatQuantity(row.levelElevation)} m`}
                        </small>
                      </td>
                      <td className="classification-cell">
                        <span>{row.costGroup ? `KG ${row.costGroup}` : "DIN not mapped"}</span>
                        <small>{row.classification || "No IFC classification"}</small>
                        <small>
                          {row.costGroupSource || "No mapping"} &middot; {row.fgk ? `FGK ${row.fgk}` : "FGK not set"}
                        </small>
                      </td>
                      <td className="pricing-basis-cell">
                        <select
                          value={row.rowId}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            updateBasisOverride(row.elementId, event.target.value)
                          }
                          aria-label={`Pricing basis for element ${row.elementId}`}
                        >
                          {row.pricingCandidates.map((candidate) => (
                            <option key={candidate.rowId} value={candidate.rowId}>
                              {candidate.quantityName} - {formatQuantity(candidate.quantityValue)} {candidate.unit}
                            </option>
                          ))}
                        </select>
                        <small>
                          {row.rateRuleLabel} &middot; {row.excludedQuantityCount} alternative{row.excludedQuantityCount === 1 ? "" : "s"} excluded
                        </small>
                      </td>
                      <td>
                        <input
                          value={rowRates[row.rowId] ?? rate}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            updateRowRate(row.rowId, event.target.value)
                          }
                          inputMode="decimal"
                          aria-label={`Unit rate for row ${row.rowId}`}
                        />
                        <small>{rateSource} &middot; EUR/{row.unit}</small>
                      </td>
                      <td>
                        <strong>{formatCurrency(rowTotal)}</strong>
                      </td>
                      <td>
                        <span className={`pricing-pill ${isPriced ? "priced" : "unpriced"}`}>
                          {isPriced ? "Priced" : "Needs rate"}
                        </span>
                        <small>{row.readiness.label}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
              </div>
            )}

            {expandedPanels.workItems && !filteredRows.length && (
              <div className="cost-empty-state">
                <Calculator size={36} />
                <p>No cost work items match the current filters.</p>
              </div>
            )}
          </section>
        </section>
      </section>
    );
  }

  function renderClassificationMappings() {
    const unmappedCount = classificationMappings.filter(
      (entry) => !entry.dinGroup
    ).length;

    return (
      <section className="rate-library-workspace classification-mapping-workspace">
        <div className="rate-library-intro">
          <div>
            <p className="cost-eyebrow">Saved automatically in this browser</p>
            <h2>Original IFC classification to DIN 276</h2>
            <p>
              The IFC classification remains unchanged. These explicit rules derive
              a DIN 276 cost group for filtering and rate matching; numeric codes from
              other systems are never treated as DIN automatically.
            </p>
          </div>
          <div className="rate-library-summary classification-mapping-summary">
            <span><strong>{discoveredClassificationCount}</strong> discovered codes</span>
            <span><strong>{completedMappingCount}</strong> completed maps</span>
            <span><strong>{analysis.summary.mappedCostGroupElements}</strong> mapped elements</span>
            <span><strong>{unmappedCount}</strong> need review</span>
          </div>
        </div>

        {message && <p className="cost-status-message">{message}</p>}

        {rawText && (
          <div className="classification-coverage-notice">
            <strong>{analysis.summary.classifiedElements}</strong> classified elements
            <span>&middot;</span>
            <strong>{analysis.summary.costGroupElements}</strong> with DIN 276 group
            <span>&middot;</span>
            <strong>{analysis.summary.unmappedClassificationElements}</strong> classified but unmapped
            <span>&middot;</span>
            <span>{analysis.summary.classificationSystems.join(", ") || "No classification system found"}</span>
          </div>
        )}

        <div className="rate-library-table-wrap">
          <table className="rate-library-table classification-mapping-table">
            <thead>
              <tr>
                <th>Active</th>
                <th>Source system</th>
                <th>Source code</th>
                <th>IFC description</th>
                <th>DIN 276 group</th>
                <th>Elements</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {classificationMappings.map((entry) => {
                const observed = findObservedClassification(
                  analysis.classificationCatalog,
                  entry
                );
                const isMapped = Boolean(entry.active && entry.dinGroup);

                return (
                  <tr key={entry.id} className={entry.active ? "" : "is-inactive"}>
                    <td>
                      <input
                        type="checkbox"
                        checked={entry.active}
                        onChange={(event) =>
                          updateClassificationMapping(entry.id, "active", event.target.checked)
                        }
                        aria-label={`Enable mapping ${entry.sourceSystem} ${entry.sourceCode}`}
                      />
                    </td>
                    <td>
                      <input
                        value={entry.sourceSystem}
                        onChange={(event) =>
                          updateClassificationMapping(entry.id, "sourceSystem", event.target.value)
                        }
                        placeholder="Uniformat"
                        aria-label={`Source system for ${entry.id}`}
                      />
                    </td>
                    <td>
                      <input
                        value={entry.sourceCode}
                        onChange={(event) =>
                          updateClassificationMapping(entry.id, "sourceCode", event.target.value)
                        }
                        placeholder="342"
                        aria-label={`Source code for ${entry.id}`}
                      />
                    </td>
                    <td>
                      <input
                        value={entry.label}
                        onChange={(event) =>
                          updateClassificationMapping(entry.id, "label", event.target.value)
                        }
                        placeholder={observed?.name || "Classification description"}
                        aria-label={`Description for ${entry.sourceSystem} ${entry.sourceCode}`}
                      />
                      {observed?.name && observed.name !== entry.label && (
                        <small>IFC: {observed.name}</small>
                      )}
                    </td>
                    <td>
                      <input
                        value={entry.dinGroup}
                        onChange={(event) =>
                          updateClassificationMapping(entry.id, "dinGroup", event.target.value)
                        }
                        placeholder="e.g. 342"
                        aria-label={`DIN 276 group for ${entry.sourceSystem} ${entry.sourceCode}`}
                      />
                    </td>
                    <td>
                      <strong>{observed?.elementCount || 0}</strong>
                    </td>
                    <td>
                      <span className={`mapping-status ${isMapped ? "mapped" : "unmapped"}`}>
                        {isMapped ? `KG ${entry.dinGroup}` : "Needs DIN group"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="delete-rate-button"
                        onClick={() => removeClassificationMapping(entry.id)}
                        aria-label={`Delete mapping ${entry.sourceSystem} ${entry.sourceCode}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!classificationMappings.length && (
          <div className="cost-compare-empty">
            <Layers size={42} />
            <h2>No classification mappings</h2>
            <p>Add a mapping or restore the built-in defaults.</p>
          </div>
        )}
      </section>
    );
  }

  function renderRateLibrary() {
    return (
      <section className="rate-library-workspace">
        <div className="rate-library-intro">
          <div>
            <p className="cost-eyebrow">Saved automatically in this browser</p>
            <h2>Unit-safe pricing rules</h2>
            <p>
              Each rule matches an IFC class to one quantity unit and preferred
              pricing basis. The first active matching rule prices the element;
              all alternative quantities are excluded from totals.
            </p>
          </div>
          <div className="rate-library-summary">
            <span><strong>{rateLibrary.length}</strong> rules</span>
            <span><strong>{activeRateCount}</strong> active</span>
            <span><strong>{new Set(rateLibrary.map((entry) => entry.elementType)).size}</strong> IFC classes</span>
          </div>
        </div>

        {message && <p className="cost-status-message">{message}</p>}

        <div className="rate-library-table-wrap">
          <table className="rate-library-table">
            <thead>
              <tr>
                <th>Active</th>
                <th>Rule name</th>
                <th>IFC class</th>
                <th>Cost group</th>
                <th>Preferred basis</th>
                <th>Unit</th>
                <th>Rate (EUR)</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rateLibrary.map((entry) => (
                <tr key={entry.id} className={entry.active ? "" : "is-inactive"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={entry.active}
                      onChange={(event) =>
                        updateRateRule(entry.id, "active", event.target.checked)
                      }
                      aria-label={`Enable ${entry.label}`}
                    />
                  </td>
                  <td>
                    <input
                      value={entry.label}
                      onChange={(event) =>
                        updateRateRule(entry.id, "label", event.target.value)
                      }
                      aria-label={`Rule name for ${entry.id}`}
                    />
                  </td>
                  <td>
                    <input
                      value={entry.elementType}
                      onChange={(event) =>
                        updateRateRule(entry.id, "elementType", event.target.value.toUpperCase())
                      }
                      placeholder="IFCWALL"
                      aria-label={`IFC class for ${entry.label}`}
                    />
                  </td>
                  <td>
                    <input
                      value={entry.costGroup}
                      onChange={(event) =>
                        updateRateRule(entry.id, "costGroup", event.target.value)
                      }
                      placeholder="Optional"
                      aria-label={`Cost group for ${entry.label}`}
                    />
                  </td>
                  <td>
                    <input
                      value={entry.quantityName}
                      onChange={(event) =>
                        updateRateRule(entry.id, "quantityName", event.target.value)
                      }
                      placeholder="NetSideArea"
                      aria-label={`Preferred quantity for ${entry.label}`}
                    />
                  </td>
                  <td>
                    <input
                      value={entry.unit}
                      onChange={(event) =>
                        updateRateRule(entry.id, "unit", event.target.value)
                      }
                      placeholder="m2"
                      aria-label={`Unit for ${entry.label}`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.rate}
                      onChange={(event) =>
                        updateRateRule(entry.id, "rate", event.target.value)
                      }
                      aria-label={`Rate for ${entry.label}`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="delete-rate-button"
                      onClick={() => removeRateRule(entry.id)}
                      aria-label={`Delete ${entry.label}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!rateLibrary.length && (
          <div className="cost-compare-empty">
            <BookOpen size={42} />
            <h2>No rate rules</h2>
            <p>Add a rule or restore the built-in defaults.</p>
          </div>
        )}
      </section>
    );
  }

  function renderCompare() {
    return (
      <section className="cost-workspace compare-workspace">
        <aside className="cost-filter-panel">
          <div className="cost-panel-heading">
            <GitCompareArrows size={18} />
            <h2>IFC snapshots</h2>
          </div>

          <SnapshotSlot
            title="Baseline IFC"
            fileName={compareFiles.baseline?.name}
            onUpload={() => baselineInputRef.current?.click()}
            onSample={() => loadSampleForCompare("baseline")}
          />
          <SnapshotSlot
            title="Target IFC"
            fileName={compareFiles.target?.name}
            onUpload={() => targetInputRef.current?.click()}
            onSample={() => loadSampleForCompare("target")}
          />

          <label>
            Search changes
            <div className="cost-input-with-icon">
              <Search size={16} />
              <input
                value={compareSearch}
                onChange={(event) => setCompareSearch(event.target.value)}
                placeholder="GlobalId, type, cost group"
              />
            </div>
          </label>
          <label>
            Change type
            <select
              value={compareStatus}
              onChange={(event) => setCompareStatus(event.target.value)}
            >
              <option value="all">All changes</option>
              <option value="added">Added</option>
              <option value="deleted">Deleted</option>
              <option value="modified">Modified</option>
            </select>
          </label>

          {comparison && (
            <div className="cost-kpi-grid">
              <span>
                <strong>{comparison.added.length}</strong>
                added
              </span>
              <span>
                <strong>{comparison.deleted.length}</strong>
                deleted
              </span>
              <span>
                <strong>{comparison.modified.length}</strong>
                modified
              </span>
              <span>
                <strong>{formatSignedCurrency(comparison.totals.delta)}</strong>
                cost delta
              </span>
            </div>
          )}
        </aside>

        <section className="cost-results-panel">
          {!comparison ? (
            <div className="cost-compare-empty">
              <GitCompareArrows size={44} />
              <h2>Compare two IFC model snapshots</h2>
              <p>
                Upload an older baseline and a newer target IFC. Elements are
                matched by GlobalId, then quantity, classification, FGK, and cost
                totals are compared.
              </p>
            </div>
          ) : (
            <>
              <div className="cost-results-header">
                <div>
                  <p className="cost-file-name">
                    {compareFiles.baseline.name} {"->"} {compareFiles.target.name}
                  </p>
                  <h2>{formatSignedCurrency(comparison.totals.delta)} cost change</h2>
                </div>
                <div className="cost-total-strip compare-strip">
                  <span>
                    <strong>{formatCurrency(comparison.totals.oldCost)}</strong>
                    baseline
                  </span>
                  <span>
                    <strong>{formatCurrency(comparison.totals.newCost)}</strong>
                    target
                  </span>
                  <span>
                    <strong>{comparison.totals.netElements >= 0 ? "+" : ""}{comparison.totals.netElements}</strong>
                    net elements
                  </span>
                </div>
              </div>

              {message && <p className="cost-status-message">{message}</p>}

              <div className="cost-change-breakdown">
                <span>
                  Added cost <strong>{formatCurrency(comparison.totals.addedCost)}</strong>
                </span>
                <span>
                  Deleted cost <strong>-{formatCurrency(comparison.totals.deletedCost)}</strong>
                </span>
                <span>
                  Modified delta <strong>{formatSignedCurrency(comparison.totals.modifiedDelta)}</strong>
                </span>
              </div>

              <div className="cost-table-wrap">
                <table className="cost-table compare-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Element</th>
                      <th>Cost group</th>
                      <th>Old cost</th>
                      <th>New cost</th>
                      <th>Delta</th>
                      <th>Changed fields</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleChanges.slice(0, 800).map(({ status, element }) => {
                      const oldCost =
                        status === "added" ? 0 : element.oldTotalCost ?? element.totalCost;
                      const newCost =
                        status === "deleted" ? 0 : element.newTotalCost ?? element.totalCost;
                      const delta = newCost - oldCost;

                      return (
                        <tr key={`${status}-${element.unique_id}`}>
                          <td>
                            <span className={`change-pill ${status}`}>{status}</span>
                          </td>
                          <td>
                            <code>{element.unique_id}</code>
                            <span>{element.category}</span>
                            <small>ExpressID #{element.element_id}</small>
                          </td>
                          <td>
                            <span>{element.family}</span>
                            <small>{element.level}</small>
                          </td>
                          <td>{formatCurrency(oldCost)}</td>
                          <td>{formatCurrency(newCost)}</td>
                          <td>
                            <strong className={delta >= 0 ? "cost-positive" : "cost-negative"}>
                              {formatSignedCurrency(delta)}
                            </strong>
                          </td>
                          <td>
                            {(element.changes || []).slice(0, 4).map((change) => (
                              <small key={`${element.unique_id}-${change.property}`}>
                                {change.property}: {String(change.old ?? "-")} {"->"} {String(change.new ?? "-")}
                              </small>
                            ))}
                            {status !== "modified" && <small>Element {status}</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!visibleChanges.length && (
                <div className="cost-empty-state">
                  <GitCompareArrows size={36} />
                  <p>No changed elements match the current filters.</p>
                </div>
              )}
            </>
          )}
        </section>
      </section>
    );
  }
}

function SnapshotSlot({ title, fileName, onUpload, onSample }) {
  return (
    <div className="snapshot-slot">
      <div>
        <span>{title}</span>
        <strong>{fileName || "No file loaded"}</strong>
      </div>
      <div>
        <button type="button" onClick={onUpload}>
          <UploadCloud size={16} />
          Upload
        </button>
        <button type="button" onClick={onSample}>
          <FileSpreadsheet size={16} />
          Sample
        </button>
      </div>
    </div>
  );
}

function buildFilterOptions(rows) {
  const uniqueValues = (key) =>
    Array.from(
      new Set(rows.map((row) => String(row[key] || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const levelMap = new Map();
  rows.forEach((row) => {
    const value = row.levelId === null ? "unassigned" : String(row.levelId);
    if (levelMap.has(value)) return;

    const elevation = Number.isFinite(row.levelElevation)
      ? ` · ${formatQuantity(row.levelElevation)} m`
      : "";
    levelMap.set(value, {
      value,
      label: `${row.level || "Unassigned"}${elevation}`,
    });
  });

  return {
    levels: Array.from(levelMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true })
    ),
    entityTypes: uniqueValues("elementType"),
    costGroups: uniqueValues("costGroup"),
    quantityNames: uniqueValues("quantityName"),
    units: uniqueValues("unit"),
  };
}

function findObservedClassification(catalog, mapping) {
  const system = String(mapping.sourceSystem || "").trim().toLowerCase();
  const code = String(mapping.sourceCode || "").trim().toLowerCase();
  return catalog.find(
    (entry) =>
      String(entry.system || "").trim().toLowerCase() === system &&
      String(entry.code || "").trim().toLowerCase() === code
  );
}

function readClassificationMappings() {
  if (typeof localStorage === "undefined") {
    return createDefaultClassificationMappings();
  }

  try {
    const saved = JSON.parse(
      localStorage.getItem(CLASSIFICATION_MAPPING_STORAGE_KEY)
    );
    const normalized = normalizeClassificationMappings(saved);
    return normalized.length
      ? normalized
      : createDefaultClassificationMappings();
  } catch {
    return createDefaultClassificationMappings();
  }
}

function readRateLibrary() {
  if (typeof localStorage === "undefined") return createDefaultRateLibrary();

  try {
    const saved = JSON.parse(localStorage.getItem(RATE_LIBRARY_STORAGE_KEY));
    const normalized = normalizeRateLibrary(saved);
    if (!normalized.length) return createDefaultRateLibrary();

    const savedIds = new Set(normalized.map((entry) => entry.id));
    const additions = createDefaultRateLibrary().filter(
      (entry) =>
        RATE_LIBRARY_MIGRATION_IDS.has(entry.id) && !savedIds.has(entry.id)
    );
    return normalized.concat(additions);
  } catch {
    return createDefaultRateLibrary();
  }
}

function createClassificationMappingId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `classification-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRateRuleId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function downloadJson(value, fileName) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(csv, fileName) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function stripExtension(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value) {
  return new Intl.NumberFormat("de-DE", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatSignedCurrency(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatCurrency(value)}`;
}

function formatQuantity(value) {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function PanelToggle({ expanded, onToggle, label }) {
  return (
    <button
      type="button"
      className="panel-toggle-button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Show less" : "Show more"} ${label}`}
    >
      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      {expanded ? "Show less" : "Show more"}
    </button>
  );
}

export default CostCalculator;
