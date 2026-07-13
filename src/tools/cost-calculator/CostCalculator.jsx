import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  GitCompareArrows,
  Layers,
  RotateCcw,
  Search,
  UploadCloud,
} from "lucide-react";
import IfcViewerComponent from "../../IfcViewer";
import {
  buildCostAnalysis,
  buildCostSnapshot,
  compareCostSnapshots,
  exportCostComparisonCsv,
  exportCostRowsCsv,
  filterCostRows,
  getRowRate,
  summarizeCosts,
} from "./ifcCostTools";
import "./cost-calculator.css";

const sampleIfcUrl = new URL("../../../sample.ifc", import.meta.url).href;

const emptyFilters = {
  search: "",
  level: "",
  entityType: "",
  unit: "",
  costGroup: "",
  quantityName: "",
  readiness: "",
};

function CostCalculator() {
  const fileInputRef = useRef(null);
  const baselineInputRef = useRef(null);
  const targetInputRef = useRef(null);
  const [mode, setMode] = useState("estimate");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [fileContent, setFileContent] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [targetFgk, setTargetFgk] = useState("300");
  const [rowRates, setRowRates] = useState({});
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

  const analysis = useMemo(
    () => buildCostAnalysis(rawText, targetFgk),
    [rawText, targetFgk]
  );
  const filteredRows = useMemo(
    () => filterCostRows(analysis.rows, filters),
    [analysis.rows, filters]
  );
  const filterOptions = useMemo(
    () => buildFilterOptions(analysis.rows),
    [analysis.rows]
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
    () => analysis.rows.filter((row) => row.elementId === selectedElementId),
    [analysis.rows, selectedElementId]
  );
  const selectedSummary = useMemo(
    () => summarizeCosts(selectedRows, rowRates),
    [selectedRows, rowRates]
  );
  const selectedElement = selectedRows[0] || null;
  const visibleSummary = useMemo(
    () => summarizeCosts(filteredRows, rowRates),
    [filteredRows, rowRates]
  );
  const fullSummary = useMemo(
    () => summarizeCosts(analysis.rows, rowRates),
    [analysis.rows, rowRates]
  );
  const comparison = useMemo(() => {
    if (!compareFiles.baseline?.text || !compareFiles.target?.text) return null;

    const baseline = buildCostSnapshot({
      name: compareFiles.baseline.name,
      text: compareFiles.baseline.text,
      targetFgk,
    });
    const target = buildCostSnapshot({
      name: compareFiles.target.name,
      text: compareFiles.target.text,
      targetFgk,
    });

    return compareCostSnapshots(baseline, target);
  }, [compareFiles, targetFgk]);

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
    const nextAnalysis = buildCostAnalysis(text, targetFgk);

    setFileName(file.name);
    setRawText(text);
    setFileContent(arrayBuffer);
    setFilters(emptyFilters);
    setRowRates({});
    setBulkRate("");
    setSelectedElementId(null);
    setViewerMessage("");
    setMessage(
      `Loaded ${nextAnalysis.summary.rows} quantity rows from ${nextAnalysis.summary.elements} cost-relevant elements.`
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
      const nextAnalysis = buildCostAnalysis(text, targetFgk);
      setFileName("sample.ifc");
      setRawText(text);
      setFileContent(arrayBuffer);
      setFilters(emptyFilters);
      setRowRates({});
      setBulkRate("");
      setSelectedElementId(null);
      setViewerMessage("");
      setMessage(
        `Loaded sample.ifc with ${nextAnalysis.summary.rows} quantity rows.`
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

  const clearFilters = () => {
    setFilters(emptyFilters);
    setSelectedElementId(null);
  };

  const updateRowRate = (rowId, value) => {
    setRowRates((current) => ({ ...current, [rowId]: value }));
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
    setMessage(`Applied ${formatCurrency(rate)} per unit to ${filteredRows.length} filtered rows.`);
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
      `Exported ${filteredRows.length} cost rows from ${visibleElementIds.length} elements.`
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
          <h1>{mode === "estimate" ? "Quantity Takeoff Cost Calculator" : "IFC Cost Change Tracker"}</h1>
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
              className={mode === "compare" ? "active" : ""}
              onClick={() => setMode("compare")}
            >
              <GitCompareArrows size={16} />
              Compare
            </button>
          </div>
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
        </div>
      </section>

      {mode === "estimate" ? renderEstimate() : renderCompare()}
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

    return (
      <section className="cost-workspace">
        <aside className="cost-filter-panel">
          <div className="cost-panel-heading">
            <div className="cost-panel-title">
              <Filter size={18} />
              <h2>Filters</h2>
              {activeFilterCount > 0 && (
                <span className="filter-count">{activeFilterCount}</span>
              )}
            </div>
            <button
              type="button"
              className="clear-filter-button"
              onClick={clearFilters}
              disabled={!activeFilterCount}
            >
              <RotateCcw size={14} />
              Clear
            </button>
          </div>

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
            Readiness
            <select
              value={filters.readiness}
              onChange={(event) => updateFilter("readiness", event.target.value)}
            >
              <option value="">All rows</option>
              <option value="ready">Ready</option>
              <option value="review">Review</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </label>

          <div className="cost-kpi-grid">
            <span>
              <strong>{analysis.summary.elements}</strong>
              elements
            </span>
            <span>
              <strong>{analysis.summary.quantityElements}</strong>
              with QTO
            </span>
            <span>
              <strong>{analysis.summary.readyRows}</strong>
              ready rows
            </span>
            <span>
              <strong>{analysis.summary.classifiedElements}</strong>
              classified
            </span>
          </div>

          <div className="bulk-rate-panel">
            <label>
              Unit rate for filtered rows
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
                rows
              </span>
              <span>
                <strong>{visibleSummary.elements.size}</strong>
                elements
              </span>
            </div>
          </div>

          {message && <p className="cost-status-message">{message}</p>}

          {(analysis.summary.fallbackRows > 0 ||
            analysis.summary.classifiedElements < analysis.summary.elements) && (
            <div className="cost-warning">
              <AlertTriangle size={18} />
              <span>
                Some rows need review because explicit IFC quantities or cost
                classifications are missing.
              </span>
            </div>
          )}

          <section className="cost-model-panel" aria-label="Filtered IFC model">
            <div className="cost-model-heading">
              <div>
                <Layers size={18} />
                <div>
                  <strong>IFC model + cost view</strong>
                  <small>
                    Filters control both the model visibility and the cost rows.
                    Click a model element or table row to connect them.
                  </small>
                </div>
              </div>
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

            <div className="cost-selection-bar">
              {selectedElement ? (
                <>
                  <span>
                    <strong>#{selectedElement.elementId} {selectedElement.elementType}</strong>
                    {selectedElement.level} · {selectedElement.elementName || "Unnamed element"}
                  </span>
                  <span>
                    <strong>{formatCurrency(selectedSummary.total)}</strong>
                    {selectedSummary.items} cost row{selectedSummary.items === 1 ? "" : "s"}
                  </span>
                </>
              ) : selectedElementId !== null ? (
                <span>
                  <strong>#{selectedElementId}</strong>
                  This model element has no cost row in the current analysis.
                </span>
              ) : (
                <span>{viewerMessage || "Select an element to see its linked cost."}</span>
              )}
            </div>
          </section>

          <div className="cost-table-wrap">
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Element</th>
                  <th>Level</th>
                  <th>Classification</th>
                  <th>Quantity</th>
                  <th>Rate</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.slice(0, 800).map((row) => {
                  const rate = getRowRate(row, rowRates);
                  const rowTotal = row.quantityValue * rate;

                  return (
                    <tr
                      key={row.rowId}
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
                      <td>
                        <span>{row.costGroup || row.classification || "-"}</span>
                        <small>{row.fgk ? `FGK ${row.fgk}` : "FGK not set"}</small>
                      </td>
                      <td>
                        <span>
                          {formatQuantity(row.quantityValue)} {row.unit}
                        </span>
                        <small>
                          {row.quantitySetName} / {row.quantityName}
                          {row.quantityId ? ` (#${row.quantityId})` : ""}
                        </small>
                      </td>
                      <td>
                        <input
                          value={rowRates[row.rowId] ?? rate}
                          onChange={(event) =>
                            updateRowRate(row.rowId, event.target.value)
                          }
                          inputMode="decimal"
                          aria-label={`Unit rate for row ${row.rowId}`}
                        />
                        <small>EUR/{row.unit}</small>
                      </td>
                      <td>
                        <strong>{formatCurrency(rowTotal)}</strong>
                      </td>
                      <td>
                        <span className={`readiness-pill ${row.readiness.level}`}>
                          {row.readiness.label}
                        </span>
                        {row.fallback && <small>count fallback</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!filteredRows.length && (
            <div className="cost-empty-state">
              <Calculator size={36} />
              <p>No cost rows match the current filters.</p>
            </div>
          )}
        </section>
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

function formatSignedCurrency(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatCurrency(value)}`;
}

function formatQuantity(value) {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export default CostCalculator;
