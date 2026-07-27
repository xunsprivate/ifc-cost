import { useMemo, useRef, useState } from "react";
import {
  Download,
  FileSearch,
  Filter,
  Pencil,
  Search,
  UploadCloud,
} from "lucide-react";
import {
  buildPropertyRows,
  filterPropertyRows,
  summarizeRows,
  updateSingleValueProperties,
} from "./ifcPropertyTools";
import "./property-batch-editor.css";

const emptyFilters = {
  search: "",
  entityType: "",
  propertySet: "",
  propertyName: "",
  currentValue: "",
};

function PropertyBatchEditor() {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [nextValue, setNextValue] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");

  const filteredRows = useMemo(
    () => filterPropertyRows(rows, filters),
    [rows, filters]
  );
  const summary = useMemo(() => summarizeRows(filteredRows), [filteredRows]);
  const allSummary = useMemo(() => summarizeRows(rows), [rows]);

  const processFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      setMessage("Upload an .ifc file.");
      return;
    }

    const text = await file.text();
    const parsedRows = buildPropertyRows(text);

    setFileName(file.name);
    setRawText(text);
    setRows(parsedRows);
    setFilters(emptyFilters);
    setNextValue("");
    setMessage(`Loaded ${parsedRows.length} editable single-value properties.`);
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

  const applyBatchEdit = () => {
    if (!rawText || !filteredRows.length) return;

    const propertyIds = Array.from(
      new Set(filteredRows.map((row) => row.propertyId))
    );
    const result = updateSingleValueProperties(rawText, propertyIds, nextValue);

    setRawText(result.text);
    setRows(buildPropertyRows(result.text));
    setMessage(`Updated ${result.updatedCount} IFC property lines.`);
  };

  const exportIfc = () => {
    if (!rawText) return;

    const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `batch_edited_${fileName || "model.ifc"}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main
      className="batch-editor"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
    >
      <section className="batch-toolbar">
        <div>
          <p className="eyebrow">IFC mini tool</p>
          <h1>Property Batch Editor</h1>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={18} />
            Upload IFC
          </button>
          <button type="button" onClick={exportIfc} disabled={!rawText}>
            <Download size={18} />
            Export
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ifc"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) processFile(file);
            }}
          />
        </div>
      </section>

      {!rawText ? (
        <section className={`drop-zone ${isDragging ? "is-dragging" : ""}`}>
          <UploadCloud size={44} />
          <h2>Drop an IFC file here</h2>
          <p>
            Editable rows are built from IfcPropertySingleValue entries linked
            through property sets.
          </p>
        </section>
      ) : (
        <section className="batch-workspace">
          <aside className="filter-panel">
            <div className="panel-heading">
              <Filter size={18} />
              <h2>Filter</h2>
            </div>

            <label>
              Search
              <div className="input-with-icon">
                <Search size={16} />
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="Element, pset, property, value"
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
              Property set
              <input
                value={filters.propertySet}
                onChange={(event) => updateFilter("propertySet", event.target.value)}
                placeholder="Pset_WallCommon"
              />
            </label>
            <label>
              Property name
              <input
                value={filters.propertyName}
                onChange={(event) => updateFilter("propertyName", event.target.value)}
                placeholder="FireRating"
              />
            </label>
            <label>
              Current value contains
              <input
                value={filters.currentValue}
                onChange={(event) => updateFilter("currentValue", event.target.value)}
                placeholder="30"
              />
            </label>

            <div className="summary-grid">
              <span>
                <strong>{summary.rows}</strong>
                rows
              </span>
              <span>
                <strong>{summary.elements}</strong>
                elements
              </span>
              <span>
                <strong>{summary.properties}</strong>
                IFC lines
              </span>
            </div>
          </aside>

          <section className="results-panel">
            <div className="results-header">
              <div>
                <p className="file-name">{fileName}</p>
                <h2>{allSummary.rows} editable properties found</h2>
              </div>
              <div className="batch-edit">
                <input
                  value={nextValue}
                  onChange={(event) => setNextValue(event.target.value)}
                  placeholder="New value for filtered rows"
                />
                <button
                  type="button"
                  onClick={applyBatchEdit}
                  disabled={!filteredRows.length}
                >
                  <Pencil size={18} />
                  Apply
                </button>
              </div>
            </div>

            {message && <p className="status-message">{message}</p>}

            <div className="property-table-wrap">
              <table className="property-table">
                <thead>
                  <tr>
                    <th>Element</th>
                    <th>Name</th>
                    <th>Property set</th>
                    <th>Property</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.rowId}>
                      <td>
                        <code>#{row.elementId}</code>
                        <span>{row.elementType}</span>
                      </td>
                      <td>{row.elementName || row.elementGlobalId || "-"}</td>
                      <td>{row.propertySetName}</td>
                      <td>
                        <span>{row.propertyName}</span>
                        <code>#{row.propertyId}</code>
                      </td>
                      <td>
                        <span>{row.propertyValue || "-"}</span>
                        <small>{row.propertyValueType}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!filteredRows.length && (
              <div className="empty-state">
                <FileSearch size={36} />
                <p>No properties match the current filters.</p>
              </div>
            )}
          </section>
        </section>
      )}
    </main>
  );
}

export default PropertyBatchEditor;
