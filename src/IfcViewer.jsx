import { useEffect, useRef } from "react";
import { Color } from "three";
import { IfcViewerAPI } from "web-ifc-viewer";

const IfcViewerComponent = ({
  fileContent,
  visibleElementIds = [],
  isFilterActive = false,
  focusedElementId = null,
  onSelectElement,
  onLoadStart,
  onLoadSuccess,
  onLoadError,
  onSelectionMiss,
}) => {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const modelRef = useRef(null);
  const visibleElementIdsRef = useRef(visibleElementIds);
  const isFilterActiveRef = useRef(isFilterActive);
  const focusedElementIdRef = useRef(focusedElementId);
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
    visibleElementIdsRef.current = visibleElementIds;
    isFilterActiveRef.current = isFilterActive;

    if (viewerRef.current && modelRef.current) {
      applyElementFilter(
        viewerRef.current,
        modelRef.current,
        visibleElementIds,
        isFilterActive
      );
    }
  }, [visibleElementIds, isFilterActive]);

  useEffect(() => {
    focusedElementIdRef.current = focusedElementId;

    if (viewerRef.current && modelRef.current) {
      focusElement(viewerRef.current, modelRef.current, focusedElementId);
    }
  }, [focusedElementId]);

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
      .then((model) => {
        if (isDisposed) return;
        modelRef.current = model;
        applyElementFilter(
          viewer,
          model,
          visibleElementIdsRef.current,
          isFilterActiveRef.current
        );
        focusElement(viewer, model, focusedElementIdRef.current);
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
        modelRef.current = null;
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

const FILTER_SUBSET_ID = "cost-filter-subset";

function applyElementFilter(viewer, model, elementIds, filterActive) {
  const manager = viewer.IFC.loader.ifcManager;

  try {
    manager.removeSubset(model.modelID, undefined, FILTER_SUBSET_ID);

    if (!filterActive) {
      model.visible = true;
      return;
    }

    model.visible = false;
    const ids = Array.from(new Set(elementIds || []));
    if (!ids.length) return;

    manager.createSubset({
      modelID: model.modelID,
      ids,
      scene: viewer.context.getScene(),
      removePrevious: true,
      customID: FILTER_SUBSET_ID,
      applyBVH: true,
    });
  } catch (error) {
    model.visible = true;
    console.warn("Could not apply IFC visibility filter", error);
  }
}

function focusElement(viewer, model, elementId) {
  if (elementId === null || elementId === undefined) {
    viewer.IFC.selector.unpickIfcItems();
    return;
  }

  viewer.IFC.selector
    .pickIfcItemsByID(model.modelID, [Number(elementId)], true, true)
    .catch((error) => console.warn("Could not focus IFC element", error));
}

export default IfcViewerComponent;
