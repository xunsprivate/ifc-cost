import React, { useState, useRef } from 'react';
import { UploadCloud, Save, Layers, AlertCircle } from 'lucide-react';
import IfcViewerComponent from './IfcViewer';

function App() {
  const [fileContent, setFileContent] = useState(null); // ArrayBuffer
  const [rawText, setRawText] = useState(""); // String representation for saving
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  
  const [selectedProps, setSelectedProps] = useState(null);
  const [editedType, setEditedType] = useState("");

  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file) => {
    if (!file.name.toLowerCase().endsWith('.ifc')) {
      alert("Please upload a valid .ifc file");
      return;
    }
    setFileName(file.name);
    
    // Read as text for editing
    const textReader = new FileReader();
    textReader.onload = (e) => setRawText(e.target.result);
    textReader.readAsText(file);

    // Read as ArrayBuffer for web-ifc
    const bufferReader = new FileReader();
    bufferReader.onload = (e) => setFileContent(e.target.result);
    bufferReader.readAsArrayBuffer(file);
  };

  const handleSelectElement = (props) => {
    setSelectedProps(props);
    if (props && props.type) {
      setEditedType(props.type);
    } else {
      setEditedType("");
    }
  };

  const handleSave = () => {
    if (!selectedProps || !editedType) return;
    
    // Simple text replacement approach for modifying IFC
    // We look for the exact line containing the ExpressID and replace the old type with the new type.
    const expressId = selectedProps.expressID;
    const oldType = selectedProps.type;
    
    if (oldType === editedType) {
      alert("No changes made.");
      return;
    }

    // Split text by lines
    const lines = rawText.split(/\r?\n/);
    
    // Find the line that starts with #expressId=
    const lineIndex = lines.findIndex(line => line.startsWith(`#${expressId}=`));
    
    if (lineIndex !== -1) {
      // Replace the exact type string on that specific line
      // e.g. #123= IFCCURTAINWALL(...) -> #123= IFCWALL(...)
      lines[lineIndex] = lines[lineIndex].replace(oldType, editedType.toUpperCase());
      const newText = lines.join('\n');
      setRawText(newText);
      
      // Update selected props to reflect change
      setSelectedProps({...selectedProps, type: editedType.toUpperCase()});
      alert(`Successfully updated ExpressID #${expressId} from ${oldType} to ${editedType.toUpperCase()}`);
    } else {
      alert("Could not find the element in the raw IFC text.");
    }
  };

  const handleExport = () => {
    if (!rawText) return;
    const blob = new Blob([rawText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modified_${fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-container">
      {/* Upload Overlay */}
      {!fileContent && (
        <div 
          className="upload-overlay"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div 
            className={`glass-panel upload-box ${isDragging ? 'dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className="upload-icon" />
            <h2>Upload IFC File</h2>
            <p style={{color: 'var(--text-secondary)'}}>
              Drag and drop your file here, or click to browse.
            </p>
            <input 
              type="file" 
              accept=".ifc" 
              style={{display: 'none'}} 
              ref={fileInputRef}
              onChange={handleFileSelect}
            />
          </div>
        </div>
      )}

      {/* 3D Viewer Area */}
      <div className="viewer-container">
        <div className="glass-panel header">
          <Layers size={24} color="var(--accent-color)" />
          <h1>IFC Web Editor</h1>
        </div>
        {fileContent && (
          <IfcViewerComponent 
            fileContent={fileContent} 
            onSelectElement={handleSelectElement} 
          />
        )}
      </div>

      {/* Properties Sidebar */}
      <div className="properties-sidebar">
        <div className="sidebar-header">
          <h3>Properties</h3>
          {selectedProps && <span style={{fontSize: '0.8rem', background: 'var(--accent-color)', padding: '2px 8px', borderRadius: '12px'}}>#{selectedProps.expressID}</span>}
        </div>
        
        <div className="properties-list">
          {!selectedProps ? (
            <div style={{textAlign: 'center', color: 'var(--text-secondary)', marginTop: '40px'}}>
              <AlertCircle size={48} style={{opacity: 0.5, marginBottom: '16px'}} />
              <p>Click on an element in the 3D viewer to see and edit its properties.</p>
            </div>
          ) : (
            <>
              <div className="property-item">
                <span className="property-label">IFC Entity Type (Editable)</span>
                <input 
                  type="text" 
                  className="property-input"
                  value={editedType}
                  onChange={(e) => setEditedType(e.target.value.toUpperCase())}
                />
              </div>
              <div className="property-item" style={{marginTop: '12px'}}>
                <button className="btn btn-primary" onClick={handleSave}>
                  Apply Change
                </button>
              </div>
              
              <div style={{height: '1px', background: 'var(--glass-border)', margin: '16px 0'}}></div>
              <h4 style={{fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px'}}>Raw Attributes</h4>
              
              {Object.keys(selectedProps).map(key => {
                if (key === 'type' || key === 'expressID') return null;
                return (
                  <div className="property-item" key={key}>
                    <span className="property-label">{key}</span>
                    <input 
                      type="text" 
                      className="property-input"
                      value={typeof selectedProps[key] === 'object' ? JSON.stringify(selectedProps[key]) : String(selectedProps[key])}
                      disabled
                    />
                  </div>
                );
              })}
            </>
          )}
        </div>

        {fileContent && (
          <div className="sidebar-footer">
            <button className="btn btn-primary" onClick={handleExport}>
              <Save size={20} />
              Export IFC
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
