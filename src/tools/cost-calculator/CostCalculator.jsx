import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Download,
  FileSpreadsheet,
  Filter,
  Search,
  UploadCloud,
} from "lucide-react";
import {
  buildCostAnalysis,
  exportCostRowsCsv,
  filterCostRows,
  getRowRate,
  summarizeCosts,
} from "./ifcCostTools";
import "./cost-calculator.css";

const sampleIfcUrl = new URL("../../../sample.ifc", import.meta.url).href;

const emptyFilters = {
  search: "",
  entityType: "",
  unit: "",
  costGroup: "",
  readiness: "",
};

function CostCalculator() {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [targetFgk, setTargetFgk] = useState("300");
  const [rowRates, setRowRates] = useState({});
  const [bulkRate, setBulkRate] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");

  const analysis = useMemo(
    () => buildCostAnalysis(rawText, targetFgk),
    [rawText, targetFgk]
  );
  const filteredRows = useMemo(
    () => filterCostRows(analysis.rows, filters),
    [analysis.rows, filters]
  );
  const visibleSummary = useMemo(
    () => summarizeCosts(filteredRows, rowRates),
    [filteredRows, rowRates]
  );
  const fullSummary = useMemo(
    () => summarizeCosts(analysis.rows, rowRates),
    [analysis.rows, rowRates]
  );

  const processFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      setMessage("Upload an .ifc file.");
      return;
    }

    const text = await file.text();
    const nextAnalysis = buildCostAnalysis(text, targetFgk);

    setFileName(file.name);
    setRawText(text);
    setFilters(emptyFilters);
    setRowRates({});
    setBulkRate("");
    setMessage(
      `Loaded ${nextAnalysis.summary.rows} quantity rows from ${nextAnalysis.summary.elements} cost-relevant elements.`
    );
  };

  const loadSample = async () => {
    try {
      const response = await fetch(sampleIfcUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();
      const nextAnalysis = buildCostAnalysis(text, targetFgk);
      setFileName("sample.ifc");
      setRawText(text);
      setFilters(emptyFilters);
      setRowRates({});
      setBulkRate("");
      setMessage(
        `Loaded sample.ifc with ${nextAnalysis.summary.rows} quantity rows.`
      );
    } catch (error) {
      setMessage(`Could not load sample.ifc: ${error.message || error}`);
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
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
    if (!analysis.rows.length) return;

    const csv = exportCostRowsCsv(analysis.rows, rowRates);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cost_calculation_${stripExtension(fileName) || "model"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
          <h1>Quantity Takeoff Cost Calculator</h1>
        </div>
        <div className="cost-toolbar-actions">
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
          <button type="button" onClick={loadSample}>
            <FileSpreadsheet size={18} />
            Sample
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={18} />
            Upload IFC
          </button>
          <button type="button" onClick={exportCsv} disabled={!analysis.rows.length}>
            <Download size={18} />
            CSV
          </button>
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
        </div>
      </section>

      {!rawText ? (
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
      ) : (
        <section className="cost-workspace">
          <aside className="cost-filter-panel">
            <div className="cost-panel-heading">
              <Filter size={18} />
              <h2>Filters</h2>
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
              IFC class
              <input
                value={filters.entityType}
                onChange={(event) => updateFilter("entityType", event.target.value)}
                placeholder="IFCWALL"
              />
            </label>
            <label>
              Unit
              <input
                value={filters.unit}
                onChange={(event) => updateFilter("unit", event.target.value)}
                placeholder="m2, m3, St"
              />
            </label>
            <label>
              Cost group
              <input
                value={filters.costGroup}
                onChange={(event) => updateFilter("costGroup", event.target.value)}
                placeholder="DIN 276"
              />
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

            <div className="cost-table-wrap">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Element</th>
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
                      <tr key={row.rowId}>
                        <td>
                          <code>#{row.elementId}</code>
                          <span>{row.elementType}</span>
                          <small>{row.elementName || row.elementGlobalId || "-"}</small>
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
      )}
    </main>
  );
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

function formatQuantity(value) {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export default CostCalculator;
