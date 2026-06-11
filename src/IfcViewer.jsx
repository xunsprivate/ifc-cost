import React, { useEffect, useRef } from 'react';
import { IfcViewerAPI } from 'web-ifc-viewer';
import { Color } from 'three';

const IfcViewerComponent = ({ fileContent, onSelectElement }) => {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize the viewer
    const viewer = new IfcViewerAPI({ container: containerRef.current, backgroundColor: new Color(0xffffff) });
    viewer.grid.setGrid();
    viewer.axes.setAxes();

    // Setup IFC wasm path
    viewer.IFC.setWasmPath('/');

    // Load the file buffer via Blob URL
    const blob = new Blob([fileContent], { type: "application/octet-stream" });
    const ifcURL = URL.createObjectURL(blob);
    viewer.IFC.loadIfcUrl(ifcURL, true).then(model => {
      // Model loaded successfully
      viewer.context.scene.add(model);
      console.log("IFC Model loaded:", model);
    }).catch(err => {
      console.error("Error loading IFC:", err);
    });

    viewerRef.current = viewer;

    // Handle click for selection
    const handleClick = async () => {
      if (!viewerRef.current) return;
      const result = await viewerRef.current.IFC.selector.pickIfcItem(false);
      if (!result) {
        viewerRef.current.IFC.selector.unpickIfcItems();
        onSelectElement(null);
        return;
      }
      const { modelID, id } = result;
      const props = await viewerRef.current.IFC.getProperties(modelID, id, true, false);

      // Get the readable IFC type string (e.g., IFCCURTAINWALL)
      const ifcType = viewerRef.current.IFC.loader.ifcManager.getIfcType(modelID, id);

      // Format properties for display
      const formattedProps = { expressID: id, type: ifcType };

      // Add other properties nicely
      if (props) {
        Object.keys(props).forEach(key => {
          if (key === 'expressID' || key === 'type') return;
          let val = props[key];
          if (val && typeof val === 'object' && val.value !== undefined) {
            val = val.value;
          }
          formattedProps[key] = val;
        });
      }

      onSelectElement(formattedProps);
    };

    containerRef.current.onclick = handleClick;

    // Handle resize
    const handleResize = () => {
      if (viewerRef.current && containerRef.current) {
        viewerRef.current.context.updateAspect();
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, [fileContent, onSelectElement]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} className="three-canvas" />;
};

export default IfcViewerComponent;
