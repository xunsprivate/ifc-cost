import { useRef, useState } from "react";
import {
  AlertCircle,
  Calculator,
  Download,
  Layers,
  PackageSearch,
  Save,
  UploadCloud,
} from "lucide-react";
import IfcViewerComponent from "./IfcViewer";
import CostCalculator from "./tools/cost-calculator/CostCalculator";
import PropertyBatchEditor from "./tools/property-batch-editor/PropertyBatchEditor";

const sampleIfcUrl = new URL("../sample.ifc", import.meta.url).href;

function App() {
  const fileInputRef = useRef(null);
  const [activeTool, setActiveTool] = useState("viewer");
  const [fileContent, setFileContent] = useState(null);
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedProps, setSelectedProps] = useState(null);
  const [editedType, setEditedType] = useState("");
  const [message, setMessage] = useState("");
  const [isModelLoading, setIsModelLoading] = useState(false);

  const loadIfcData = ({
    fileName: nextFileName,
    rawText: nextRawText,
    arrayBuffer,
  }) => {
    if (!nextFileName.toLowerCase().endsWith(".ifc")) {
      setIsModelLoading(false);
      setMessage("Upload an .ifc file.");
      return;
    }

    setFileName(nextFileName);
    setSelectedProps(null);
    setEditedType("");
    setFileContent(null);
    setRawText(nextRawText);
    setIsModelLoading(true);
    setMessage("Loading IFC model...");
    setFileContent(arrayBuffer);
  };

  const processFile = (file) => {
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      setIsModelLoading(false);
      setMessage("Upload an .ifc file.");
      return;
    }

    const textReader = new FileReader();
    textReader.onload = (event) => {
      const nextRawText = event.target.result || "";
      const bufferReader = new FileReader();
      bufferReader.onload = (bufferEvent) => {
        loadIfcData({
          fileName: file.name,
          rawText: nextRawText,
          arrayBuffer: bufferEvent.target.result,
        });
      };
      bufferReader.readAsArrayBuffer(file);
    };
    textReader.readAsText(file);
  };

  const handleLoadSample = async () => {
    setIsModelLoading(true);
    setMessage("Loading sample.ifc...");

    try {
      const response = await fetch(sampleIfcUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const rawText = new TextDecoder("utf-8").decode(arrayBuffer);
      loadIfcData({
        fileName: "sample.ifc",
        rawText,
        arrayBuffer,
      });
    } catch (error) {
      setIsModelLoading(false);
      setMessage(`Could not load sample.ifc: ${error.message || error}`);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleSelectElement = (props) => {
    setSelectedProps(props);
    setEditedType(props?.type || "");
  };

  const handleSaveType = () => {
    if (!selectedProps || !editedType || !rawText) return;

    const expressId = selectedProps.expressID;
    const oldType = selectedProps.type;
    const nextType = editedType.trim().toUpperCase();

    if (!nextType || oldType === nextType) {
      setMessage("No type change to apply.");
      return;
    }

    const lines = rawText.split(/\r?\n/);
    const lineIndex = lines.findIndex((line) =>
      line.trimStart().startsWith(`#${expressId}=`)
    );

    if (lineIndex === -1) {
      setMessage(`Could not find IFC line #${expressId}.`);
      return;
    }

    lines[lineIndex] = lines[lineIndex].replace(
      new RegExp(`^(\\s*#${expressId}\\s*=\\s*)${oldType}\\b`),
      `$1${nextType}`
    );
    setRawText(lines.join("\n"));
    setSelectedProps({ ...selectedProps, type: nextType });
    setMessage(`Updated #${expressId} from ${oldType} to ${nextType}.`);
  };

  const handleExport = () => {
    if (!rawText) return;

    const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `modified_${fileName || "model.ifc"}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (activeTool === "batch") {
    return (
      <>
        <ToolSwitcher activeTool={activeTool} setActiveTool={setActiveTool} />
        <PropertyBatchEditor />
      </>
    );
  }

  if (activeTool === "cost") {
    return (
      <>
        <ToolSwitcher activeTool={activeTool} setActiveTool={setActiveTool} />
        <CostCalculator />
      </>
    );
  }

  return (
    <main className="app-container">
      <ToolSwitcher activeTool={activeTool} setActiveTool={setActiveTool} />

      {!fileContent && (
        <section
          className="upload-overlay"
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <button
            type="button"
            className={`glass-panel upload-box ${isDragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className="upload-icon" />
            <span>Upload IFC File</span>
            <small>Drag and drop a model here, or click to browse.</small>
          </button>
          <button
            type="button"
            className="sample-button"
            onClick={handleLoadSample}
          >
            Load sample.ifc
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ifc"
            onChange={handleFileSelect}
            className="visually-hidden"
          />
        </section>
      )}

      <section className="viewer-container">
        <header className="glass-panel header">
          <Layers size={24} color="var(--accent-color)" />
          <div>
            <h1>IFC Web Editor</h1>
            <p>{fileName || "No model loaded"}</p>
          </div>
        </header>
        {fileContent ? (
          <IfcViewerComponent
            fileContent={fileContent}
            onSelectElement={handleSelectElement}
            onLoadStart={() => setIsModelLoading(true)}
            onLoadSuccess={() => {
              setIsModelLoading(false);
              setMessage(`Loaded ${fileName}`);
            }}
            onLoadError={(error) => {
              setIsModelLoading(false);
              setMessage(error);
            }}
            onSelectionMiss={() => setMessage("No IFC element found at that cursor position.")}
          />
        ) : (
          <div className="viewer-empty">
            <PackageSearch size={48} />
          </div>
        )}
        {isModelLoading && (
          <div className="loading-overlay">
            <div className="loader" />
            <p>Preparing IFC geometry...</p>
          </div>
        )}
      </section>

      <aside className="properties-sidebar">
        <div className="sidebar-header">
          <div>
            <h2>Properties</h2>
            <p>{selectedProps ? `ExpressID #${selectedProps.expressID}` : "Select an element"}</p>
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={18} />
          </button>
        </div>

        <div className="properties-list">
          {!selectedProps ? (
            <div className="empty-properties">
              <AlertCircle size={40} />
              <p>Click an element in the 3D model to inspect its IFC data.</p>
            </div>
          ) : (
            <>
              <label className="property-item">
                <span className="property-label">IFC Entity Type</span>
                <input
                  type="text"
                  className="property-input"
                  value={editedType}
                  onChange={(event) =>
                    setEditedType(event.target.value.toUpperCase())
                  }
                />
              </label>
              <button type="button" className="btn btn-primary" onClick={handleSaveType}>
                <Save size={18} />
                Apply Type Change
              </button>
              <div className="property-divider" />
              {Object.entries(selectedProps)
                .filter(([key]) => key !== "type" && key !== "expressID")
                .map(([key, value]) => (
                  <label className="property-item" key={key}>
                    <span className="property-label">{key}</span>
                    <input
                      type="text"
                      className="property-input"
                      value={
                        typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value ?? "")
                      }
                      disabled
                    />
                  </label>
                ))}
            </>
          )}
        </div>

        {message && <p className="viewer-message">{message}</p>}

        <div className="sidebar-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExport}
            disabled={!rawText}
          >
            <Download size={18} />
            Export IFC
          </button>
        </div>
      </aside>
    </main>
  );
}

function ToolSwitcher({ activeTool, setActiveTool }) {
  return (
    <nav className="tool-switcher" aria-label="IFC tools">
      <button
        type="button"
        className={activeTool === "viewer" ? "active" : ""}
        onClick={() => setActiveTool("viewer")}
      >
        <Layers size={16} />
        IFC Viewer
      </button>
      <button
        type="button"
        className={activeTool === "batch" ? "active" : ""}
        onClick={() => setActiveTool("batch")}
      >
        <PackageSearch size={16} />
        Batch Editor
      </button>
      <button
        type="button"
        className={activeTool === "cost" ? "active" : ""}
        onClick={() => setActiveTool("cost")}
      >
        <Calculator size={16} />
        Cost Calculator
      </button>
    </nav>
  );
}

export default App;
