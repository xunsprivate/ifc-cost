import { useEffect, useRef } from "react";
import { Color } from "three";
import { IfcViewerAPI } from "web-ifc-viewer";

const IfcViewerComponent = ({
  fileContent,
  onSelectElement,
  onLoadStart,
  onLoadSuccess,
  onLoadError,
  onSelectionMiss,
}) => {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const selectHandlerRef = useRef(onSelectElement);
  const loadStartRef = useRef(onLoadStart);
  const loadSuccessRef = useRef(onLoadSuccess);
  const loadErrorRef = useRef(onLoadError);
  const selectionMissRef = useRef(onSelectionMiss);

  useEffect(() => {
    selectHandlerRef.current = onSelectElement;
  }, [onSelectElement]);

  useEffect(() => {
    loadStartRef.current = onLoadStart;
  }, [onLoadStart]);

  useEffect(() => {
    loadSuccessRef.current = onLoadSuccess;
  }, [onLoadSuccess]);

  useEffect(() => {
    loadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    selectionMissRef.current = onSelectionMiss;
  }, [onSelectionMiss]);

  useEffect(() => {
    if (!containerRef.current) return;
    const containerEl = containerRef.current;
    loadStartRef.current?.();

    const viewer = new IfcViewerAPI({
      container: containerEl,
      backgroundColor: new Color(0xf4f2ed),
    });
    viewer.grid.setGrid();
    viewer.axes.setAxes();
    viewer.IFC.setWasmPath(import.meta.env.BASE_URL);

    // Load the file buffer via Blob URL
    const blob = new Blob([fileContent], { type: "application/octet-stream" });
    const ifcURL = URL.createObjectURL(blob);
    let isDisposed = false;

    viewer.IFC.loadIfcUrl(ifcURL, true)
      .then(() => {
        if (isDisposed) return;
        viewer.context.fitToFrame();
        loadSuccessRef.current?.();
      })
      .catch((error) => {
        if (isDisposed) return;
        loadErrorRef.current?.(`Error loading IFC: ${error.message || error}`);
      });

    viewerRef.current = viewer;
    if (import.meta.env.DEV) {
      globalThis.__ifcViewer = viewer;
    }

    const syncMousePosition = (event) => {
      if (!viewerRef.current) return;

      const bounds = containerEl.getBoundingClientRect();
      const relativeX = (event.clientX - bounds.left) / bounds.width;
      const relativeY = (event.clientY - bounds.top) / bounds.height;

      viewerRef.current.context.mouse.rawPosition.x = event.clientX;
      viewerRef.current.context.mouse.rawPosition.y = event.clientY;
      viewerRef.current.context.mouse.position.x = relativeX * 2 - 1;
      viewerRef.current.context.mouse.position.y = -(relativeY * 2 - 1);
    };

    const handleMouseMove = (event) => {
      syncMousePosition(event);
    };

    const handleClick = async (event) => {
      if (!viewerRef.current) return;
      syncMousePosition(event);
      const result = await viewerRef.current.IFC.selector.pickIfcItem(false);
      if (!result) {
        viewerRef.current.IFC.selector.unpickIfcItems();
        selectHandlerRef.current?.(null);
        selectionMissRef.current?.();
        return;
      }
      const { modelID, id } = result;
      const props = await viewerRef.current.IFC.getProperties(modelID, id, true, false);

      const ifcType = viewerRef.current.IFC.loader.ifcManager.getIfcType(modelID, id);
      const formattedProps = { expressID: id, type: ifcType };

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

      selectHandlerRef.current?.(formattedProps);
    };

    containerEl.addEventListener("mousemove", handleMouseMove);
    containerEl.addEventListener("click", handleClick);

    const handleResize = () => {
      if (viewerRef.current && containerRef.current) {
        viewerRef.current.context.updateAspect();
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      isDisposed = true;
      containerEl.removeEventListener("mousemove", handleMouseMove);
      containerEl.removeEventListener("click", handleClick);
      window.removeEventListener("resize", handleResize);
      URL.revokeObjectURL(ifcURL);
      if (viewerRef.current) {
        if (import.meta.env.DEV && globalThis.__ifcViewer === viewerRef.current) {
          delete globalThis.__ifcViewer;
        }
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, [fileContent]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
      className="three-canvas"
    />
  );
};

export default IfcViewerComponent;
