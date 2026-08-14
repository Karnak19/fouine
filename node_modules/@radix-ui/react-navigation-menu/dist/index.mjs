"use client";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/navigation-menu.tsx
import * as React from "react";
import * as ReactDOM from "react-dom";
import { createContextScope } from "@radix-ui/react-context";
import { composeEventHandlers } from "@radix-ui/primitive";
import { Primitive, dispatchDiscreteCustomEvent } from "@radix-ui/react-primitive";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { useDirection } from "@radix-ui/react-direction";
import { Presence } from "@radix-ui/react-presence";
import { useId } from "@radix-ui/react-id";
import { createCollection } from "@radix-ui/react-collection";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { usePrevious } from "@radix-ui/react-use-previous";
import { useLayoutEffect } from "@radix-ui/react-use-layout-effect";
import { useCallbackRef } from "@radix-ui/react-use-callback-ref";
import * as VisuallyHiddenPrimitive from "@radix-ui/react-visually-hidden";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var NAVIGATION_MENU_NAME = "NavigationMenu";
var [Collection, useCollection, createCollectionScope] = createCollection(NAVIGATION_MENU_NAME);
var [FocusGroupCollection, useFocusGroupCollection, createFocusGroupCollectionScope] = createCollection(NAVIGATION_MENU_NAME);
var [createNavigationMenuContext, createNavigationMenuScope] = createContextScope(
  NAVIGATION_MENU_NAME,
  [createCollectionScope, createFocusGroupCollectionScope]
);
var [NavigationMenuProviderImpl, useNavigationMenuContext] = createNavigationMenuContext(NAVIGATION_MENU_NAME);
var [ViewportContentProvider, useViewportContentContext] = createNavigationMenuContext(NAVIGATION_MENU_NAME);
var NavigationMenu = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function NavigationMenu2(props, forwardedRef) {
    const {
      __scopeNavigationMenu,
      value: valueProp,
      onValueChange,
      defaultValue,
      delayDuration = 200,
      skipDelayDuration = 300,
      orientation = "horizontal",
      dir,
      ...NavigationMenuProps
    } = props;
    const [navigationMenu, setNavigationMenu] = React.useState(null);
    const composedRef = useComposedRefs(forwardedRef, setNavigationMenu);
    const direction = useDirection(dir);
    const openTimerRef = React.useRef(0);
    const closeTimerRef = React.useRef(0);
    const skipDelayTimerRef = React.useRef(0);
    const [isOpenDelayed, setIsOpenDelayed] = React.useState(true);
    const [value, setValue] = useControllableState({
      prop: valueProp,
      onChange: /* @__PURE__ */ __name((value2) => {
        const isOpen = value2 !== "";
        const hasSkipDelayDuration = skipDelayDuration > 0;
        if (isOpen) {
          window.clearTimeout(skipDelayTimerRef.current);
          if (hasSkipDelayDuration) setIsOpenDelayed(false);
        } else {
          window.clearTimeout(skipDelayTimerRef.current);
          skipDelayTimerRef.current = window.setTimeout(
            () => setIsOpenDelayed(true),
            skipDelayDuration
          );
        }
        onValueChange?.(value2);
      }, "onChange"),
      defaultProp: defaultValue ?? "",
      caller: NAVIGATION_MENU_NAME
    });
    const startCloseTimer = React.useCallback(() => {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => setValue(""), 150);
    }, [setValue]);
    const handleOpen = React.useCallback(
      (itemValue) => {
        window.clearTimeout(closeTimerRef.current);
        setValue(itemValue);
      },
      [setValue]
    );
    const handleDelayedOpen = React.useCallback(
      (itemValue) => {
        const isOpenItem = value === itemValue;
        if (isOpenItem) {
          window.clearTimeout(closeTimerRef.current);
        } else {
          openTimerRef.current = window.setTimeout(() => {
            window.clearTimeout(closeTimerRef.current);
            setValue(itemValue);
          }, delayDuration);
        }
      },
      [value, setValue, delayDuration]
    );
    React.useEffect(() => {
      return () => {
        window.clearTimeout(openTimerRef.current);
        window.clearTimeout(closeTimerRef.current);
        window.clearTimeout(skipDelayTimerRef.current);
      };
    }, []);
    return /* @__PURE__ */ jsx(
      NavigationMenuProvider,
      {
        scope: __scopeNavigationMenu,
        isRootMenu: true,
        value,
        dir: direction,
        orientation,
        rootNavigationMenu: navigationMenu,
        onTriggerEnter: (itemValue) => {
          window.clearTimeout(openTimerRef.current);
          if (isOpenDelayed) handleDelayedOpen(itemValue);
          else handleOpen(itemValue);
        },
        onTriggerLeave: () => {
          window.clearTimeout(openTimerRef.current);
          startCloseTimer();
        },
        onContentEnter: () => window.clearTimeout(closeTimerRef.current),
        onContentLeave: startCloseTimer,
        onItemSelect: (itemValue) => {
          setValue((prevValue) => prevValue === itemValue ? "" : itemValue);
        },
        onItemDismiss: () => setValue(""),
        children: /* @__PURE__ */ jsx(
          Primitive.nav,
          {
            "aria-label": "Main",
            "data-orientation": orientation,
            dir: direction,
            ...NavigationMenuProps,
            ref: composedRef
          }
        )
      }
    );
  }, "NavigationMenu")
);
var SUB_NAME = "NavigationMenuSub";
var NavigationMenuSub = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function NavigationMenuSub2(props, forwardedRef) {
    const {
      __scopeNavigationMenu,
      value: valueProp,
      onValueChange,
      defaultValue,
      orientation = "horizontal",
      ...subProps
    } = props;
    const context = useNavigationMenuContext(SUB_NAME, __scopeNavigationMenu);
    const [value, setValue] = useControllableState({
      prop: valueProp,
      onChange: onValueChange,
      defaultProp: defaultValue ?? "",
      caller: SUB_NAME
    });
    return /* @__PURE__ */ jsx(
      NavigationMenuProvider,
      {
        scope: __scopeNavigationMenu,
        isRootMenu: false,
        value,
        dir: context.dir,
        orientation,
        rootNavigationMenu: context.rootNavigationMenu,
        onTriggerEnter: (itemValue) => setValue(itemValue),
        onItemSelect: (itemValue) => setValue(itemValue),
        onItemDismiss: () => setValue(""),
        children: /* @__PURE__ */ jsx(Primitive.div, { "data-orientation": orientation, ...subProps, ref: forwardedRef })
      }
    );
  }, "NavigationMenuSub")
);
var NavigationMenuProvider = /* @__PURE__ */ __name((props) => {
  const {
    scope,
    isRootMenu,
    rootNavigationMenu,
    dir,
    orientation,
    children,
    value,
    onItemSelect,
    onItemDismiss,
    onTriggerEnter,
    onTriggerLeave,
    onContentEnter,
    onContentLeave
  } = props;
  const [viewport, setViewport] = React.useState(null);
  const [viewportContent, setViewportContent] = React.useState(/* @__PURE__ */ new Map());
  const [indicatorTrack, setIndicatorTrack] = React.useState(null);
  return /* @__PURE__ */ jsx(
    NavigationMenuProviderImpl,
    {
      scope,
      isRootMenu,
      rootNavigationMenu,
      value,
      previousValue: usePrevious(value),
      baseId: useId(),
      dir,
      orientation,
      viewport,
      onViewportChange: setViewport,
      indicatorTrack,
      onIndicatorTrackChange: setIndicatorTrack,
      onTriggerEnter: useCallbackRef(onTriggerEnter),
      onTriggerLeave: useCallbackRef(onTriggerLeave),
      onContentEnter: useCallbackRef(onContentEnter),
      onContentLeave: useCallbackRef(onContentLeave),
      onItemSelect: useCallbackRef(onItemSelect),
      onItemDismiss: useCallbackRef(onItemDismiss),
      onViewportContentChange: React.useCallback((contentValue, contentData) => {
        setViewportContent((prevContent) => {
          prevContent.set(contentValue, contentData);
          return new Map(prevContent);
        });
      }, []),
      onViewportContentRemove: React.useCallback((contentValue) => {
        setViewportContent((prevContent) => {
          if (!prevContent.has(contentValue)) return prevContent;
          prevContent.delete(contentValue);
          return new Map(prevContent);
        });
      }, []),
      children: /* @__PURE__ */ jsx(Collection.Provider, { scope, children: /* @__PURE__ */ jsx(ViewportContentProvider, { scope, items: viewportContent, children }) })
    }
  );
}, "NavigationMenuProvider");
var LIST_NAME = "NavigationMenuList";
var NavigationMenuList = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function NavigationMenuList2(props, forwardedRef) {
    const { __scopeNavigationMenu, ...listProps } = props;
    const context = useNavigationMenuContext(LIST_NAME, __scopeNavigationMenu);
    const list = /* @__PURE__ */ jsx(Primitive.ul, { "data-orientation": context.orientation, ...listProps, ref: forwardedRef });
    return /* @__PURE__ */ jsx(Primitive.div, { style: { position: "relative" }, ref: context.onIndicatorTrackChange, children: /* @__PURE__ */ jsx(Collection.Slot, { scope: __scopeNavigationMenu, children: context.isRootMenu ? /* @__PURE__ */ jsx(FocusGroup, { asChild: true, children: list }) : list }) });
  }, "NavigationMenuList")
);
var ITEM_NAME = "NavigationMenuItem";
var [NavigationMenuItemContextProvider, useNavigationMenuItemContext] = createNavigationMenuContext(ITEM_NAME);
var NavigationMenuItem = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function NavigationMenuItem2(props, forwardedRef) {
    const { __scopeNavigationMenu, value: valueProp, ...itemProps } = props;
    const autoValue = useId();
    const value = valueProp || autoValue || "LEGACY_REACT_AUTO_VALUE";
    const contentRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const focusProxyRef = React.useRef(null);
    const restoreContentTabOrderRef = React.useRef(() => {
    });
    const wasEscapeCloseRef = React.useRef(false);
    const handleContentEntry = React.useCallback((side = "start") => {
      if (contentRef.current) {
        restoreContentTabOrderRef.current();
        const candidates = getTabbableCandidates(contentRef.current);
        if (candidates.length) focusFirst(side === "start" ? candidates : candidates.reverse());
      }
    }, []);
    const handleContentExit = React.useCallback(() => {
      if (contentRef.current) {
        const candidates = getTabbableCandidates(contentRef.current);
        if (candidates.length) restoreContentTabOrderRef.current = removeFromTabOrder(candidates);
      }
    }, []);
    return /* @__PURE__ */ jsx(
      NavigationMenuItemContextProvider,
      {
        scope: __scopeNavigationMenu,
        value,
        triggerRef,
        contentRef,
        focusProxyRef,
        wasEscapeCloseRef,
        onEntryKeyDown: handleContentEntry,
        onFocusProxyEnter: handleContentEntry,
        onRootContentClose: handleContentExit,
        onContentFocusOutside: handleContentExit,
        children: /* @__PURE__ */ jsx(Primitive.li, { ...itemProps, ref: forwardedRef })
      }
    );
  }, "NavigationMenuItem")
);
var TRIGGER_NAME = "NavigationMenuTrigger";
var NavigationMenuTrigger = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function NavigationMenuTrigger2(props, forwardedRef) {
  const { __scopeNavigationMenu, disabled, ...triggerProps } = props;
  const context = useNavigationMenuContext(TRIGGER_NAME, props.__scopeNavigationMenu);
  const itemContext = useNavigationMenuItemContext(TRIGGER_NAME, props.__scopeNavigationMenu);
  const ref = React.useRef(null);
  const composedRefs = useComposedRefs(ref, itemContext.triggerRef, forwardedRef);
  const triggerId = makeTriggerId(context.baseId, itemContext.value);
  const contentId = makeContentId(context.baseId, itemContext.value);
  const hasPointerMoveOpenedRef = React.useRef(false);
  const wasClickCloseRef = React.useRef(false);
  const open = itemContext.value === context.value;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(Collection.ItemSlot, { scope: __scopeNavigationMenu, value: itemContext.value, children: /* @__PURE__ */ jsx(FocusGroupItem, { asChild: true, children: /* @__PURE__ */ jsx(
      Primitive.button,
      {
        id: triggerId,
        disabled,
        "data-disabled": disabled ? "" : void 0,
        "data-state": getOpenState(open),
        "aria-expanded": open,
        "aria-controls": open ? contentId : void 0,
        ...triggerProps,
        ref: composedRefs,
        onPointerEnter: composeEventHandlers(props.onPointerEnter, () => {
          wasClickCloseRef.current = false;
          itemContext.wasEscapeCloseRef.current = false;
        }),
        onPointerMove: composeEventHandlers(
          props.onPointerMove,
          whenMouse(() => {
            if (disabled || wasClickCloseRef.current || itemContext.wasEscapeCloseRef.current || hasPointerMoveOpenedRef.current)
              return;
            context.onTriggerEnter(itemContext.value);
            hasPointerMoveOpenedRef.current = true;
          })
        ),
        onPointerLeave: composeEventHandlers(
          props.onPointerLeave,
          whenMouse(() => {
            if (disabled) return;
            context.onTriggerLeave();
            hasPointerMoveOpenedRef.current = false;
          })
        ),
        onClick: composeEventHandlers(props.onClick, () => {
          context.onItemSelect(itemContext.value);
          wasClickCloseRef.current = open;
        }),
        onKeyDown: composeEventHandlers(props.onKeyDown, (event) => {
          const verticalEntryKey = context.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
          const entryKey = { horizontal: "ArrowDown", vertical: verticalEntryKey }[context.orientation];
          if (open && event.key === entryKey) {
            itemContext.onEntryKeyDown();
            event.preventDefault();
          }
        })
      }
    ) }) }),
    open && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(
        VisuallyHiddenPrimitive.Root,
        {
          "aria-hidden": true,
          tabIndex: 0,
          ref: itemContext.focusProxyRef,
          onFocus: (event) => {
            const content = itemContext.contentRef.current;
            const prevFocusedElement = event.relatedTarget;
            const wasTriggerFocused = prevFocusedElement === ref.current;
            const wasFocusFromContent = content?.contains(prevFocusedElement);
            if (wasTriggerFocused || !wasFocusFromContent) {
              itemContext.onFocusProxyEnter(wasTriggerFocused ? "start" : "end");
            }
          }
        }
      ),
      context.viewport && /* @__PURE__ */ jsx("span", { "aria-owns": contentId })
    ] })
  ] });
}, "NavigationMenuTrigger"));
var LINK_SELECT = "navigationMenu.linkSelect";
var NavigationMenuLink = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function NavigationMenuLink2(props, forwardedRef) {
    const { __scopeNavigationMenu, active, onSelect, ...linkProps } = props;
    return /* @__PURE__ */ jsx(FocusGroupItem, { asChild: true, children: /* @__PURE__ */ jsx(
      Primitive.a,
      {
        "data-active": active ? "" : void 0,
        "aria-current": active ? "page" : void 0,
        ...linkProps,
        ref: forwardedRef,
        onClick: composeEventHandlers(
          props.onClick,
          (event) => {
            const target = event.target;
            const linkSelectEvent = new CustomEvent(LINK_SELECT, {
              bubbles: true,
              cancelable: true
            });
            target.addEventListener(LINK_SELECT, (event2) => onSelect?.(event2), { once: true });
            dispatchDiscreteCustomEvent(target, linkSelectEvent);
            if (!linkSelectEvent.defaultPrevented && !event.metaKey) {
              const rootContentDismissEvent = new CustomEvent(ROOT_CONTENT_DISMISS, {
                bubbles: true,
                cancelable: true
              });
              dispatchDiscreteCustomEvent(target, rootContentDismissEvent);
            }
          },
          { checkForDefaultPrevented: false }
        )
      }
    ) });
  }, "NavigationMenuLink")
);
var INDICATOR_NAME = "NavigationMenuIndicator";
var NavigationMenuIndicator = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function NavigationMenuIndicator2(props, forwardedRef) {
  const { forceMount, ...indicatorProps } = props;
  const context = useNavigationMenuContext(INDICATOR_NAME, props.__scopeNavigationMenu);
  const isVisible = Boolean(context.value);
  return context.indicatorTrack ? ReactDOM.createPortal(
    /* @__PURE__ */ jsx(Presence, { present: forceMount || isVisible, children: /* @__PURE__ */ jsx(NavigationMenuIndicatorImpl, { ...indicatorProps, ref: forwardedRef }) }),
    context.indicatorTrack
  ) : null;
}, "NavigationMenuIndicator"));
var NavigationMenuIndicatorImpl = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function NavigationMenuIndicatorImpl2(props, forwardedRef) {
  const { __scopeNavigationMenu, ...indicatorProps } = props;
  const context = useNavigationMenuContext(INDICATOR_NAME, __scopeNavigationMenu);
  const getItems = useCollection(__scopeNavigationMenu);
  const [activeTrigger, setActiveTrigger] = React.useState(
    null
  );
  const [position, setPosition] = React.useState(null);
  const isHorizontal = context.orientation === "horizontal";
  const isVisible = Boolean(context.value);
  React.useEffect(() => {
    const items = getItems();
    const triggerNode = items.find((item) => item.value === context.value)?.ref.current;
    if (triggerNode) setActiveTrigger(triggerNode);
  }, [getItems, context.value]);
  const handlePositionChange = /* @__PURE__ */ __name(() => {
    if (activeTrigger) {
      setPosition({
        size: isHorizontal ? activeTrigger.offsetWidth : activeTrigger.offsetHeight,
        offset: isHorizontal ? activeTrigger.offsetLeft : activeTrigger.offsetTop
      });
    }
  }, "handlePositionChange");
  useResizeObserver(activeTrigger, handlePositionChange);
  useResizeObserver(context.indicatorTrack, handlePositionChange);
  return position ? /* @__PURE__ */ jsx(
    Primitive.div,
    {
      "aria-hidden": true,
      "data-state": isVisible ? "visible" : "hidden",
      "data-orientation": context.orientation,
      ...indicatorProps,
      ref: forwardedRef,
      style: {
        position: "absolute",
        ...isHorizontal ? {
          left: 0,
          width: position.size + "px",
          transform: `translateX(${position.offset}px)`,
          "--radix-navigation-menu-indicator-translate-x": `${position.offset}px`
        } : {
          top: 0,
          height: position.size + "px",
          transform: `translateY(${position.offset}px)`,
          "--radix-navigation-menu-indicator-translate-y": `${position.offset}px`
        },
        ...indicatorProps.style
      }
    }
  ) : null;
}, "NavigationMenuIndicatorImpl"));
var CONTENT_NAME = "NavigationMenuContent";
var NavigationMenuContent = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function NavigationMenuContent2(props, forwardedRef) {
  const { forceMount, ...contentProps } = props;
  const context = useNavigationMenuContext(CONTENT_NAME, props.__scopeNavigationMenu);
  const itemContext = useNavigationMenuItemContext(CONTENT_NAME, props.__scopeNavigationMenu);
  const composedRefs = useComposedRefs(itemContext.contentRef, forwardedRef);
  const open = itemContext.value === context.value;
  const commonProps = {
    value: itemContext.value,
    triggerRef: itemContext.triggerRef,
    focusProxyRef: itemContext.focusProxyRef,
    wasEscapeCloseRef: itemContext.wasEscapeCloseRef,
    onContentFocusOutside: itemContext.onContentFocusOutside,
    onRootContentClose: itemContext.onRootContentClose,
    ...contentProps
  };
  return !context.viewport ? /* @__PURE__ */ jsx(Presence, { present: forceMount || open, children: /* @__PURE__ */ jsx(
    NavigationMenuContentImpl,
    {
      "data-state": getOpenState(open),
      ...commonProps,
      ref: composedRefs,
      onPointerEnter: composeEventHandlers(props.onPointerEnter, context.onContentEnter),
      onPointerLeave: composeEventHandlers(
        props.onPointerLeave,
        whenMouse(context.onContentLeave)
      ),
      style: {
        // Prevent interaction when animating out
        pointerEvents: !open && context.isRootMenu ? "none" : void 0,
        ...commonProps.style
      }
    }
  ) }) : /* @__PURE__ */ jsx(ViewportContentMounter, { forceMount, ...commonProps, ref: composedRefs });
}, "NavigationMenuContent"));
var ViewportContentMounter = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function ViewportContentMounter2(props, forwardedRef) {
  const context = useNavigationMenuContext(CONTENT_NAME, props.__scopeNavigationMenu);
  const { onViewportContentChange, onViewportContentRemove } = context;
  useLayoutEffect(() => {
    onViewportContentChange(props.value, {
      ref: forwardedRef,
      ...props
    });
  }, [props, forwardedRef, onViewportContentChange]);
  useLayoutEffect(() => {
    return () => onViewportContentRemove(props.value);
  }, [props.value, onViewportContentRemove]);
  return null;
}, "ViewportContentMounter"));
var ROOT_CONTENT_DISMISS = "navigationMenu.rootContentDismiss";
var NavigationMenuContentImpl = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function NavigationMenuContentImpl2(props, forwardedRef) {
  const {
    __scopeNavigationMenu,
    value,
    triggerRef,
    focusProxyRef,
    wasEscapeCloseRef,
    onRootContentClose,
    onContentFocusOutside,
    ...contentProps
  } = props;
  const context = useNavigationMenuContext(CONTENT_NAME, __scopeNavigationMenu);
  const ref = React.useRef(null);
  const composedRefs = useComposedRefs(ref, forwardedRef);
  const triggerId = makeTriggerId(context.baseId, value);
  const contentId = makeContentId(context.baseId, value);
  const getItems = useCollection(__scopeNavigationMenu);
  const prevMotionAttributeRef = React.useRef(null);
  const { onItemDismiss } = context;
  React.useEffect(() => {
    const content = ref.current;
    if (context.isRootMenu && content) {
      const handleClose = /* @__PURE__ */ __name(() => {
        onItemDismiss();
        onRootContentClose();
        if (content.contains(document.activeElement)) triggerRef.current?.focus();
      }, "handleClose");
      content.addEventListener(ROOT_CONTENT_DISMISS, handleClose);
      return () => content.removeEventListener(ROOT_CONTENT_DISMISS, handleClose);
    }
  }, [context.isRootMenu, props.value, triggerRef, onItemDismiss, onRootContentClose]);
  const motionAttribute = React.useMemo(() => {
    const items = getItems();
    const values = items.map((item) => item.value);
    if (context.dir === "rtl") values.reverse();
    const index = values.indexOf(context.value);
    const prevIndex = values.indexOf(context.previousValue);
    const isSelected = value === context.value;
    const wasSelected = prevIndex === values.indexOf(value);
    if (!isSelected && !wasSelected) return prevMotionAttributeRef.current;
    const attribute = (() => {
      if (index !== prevIndex) {
        if (isSelected && prevIndex !== -1) return index > prevIndex ? "from-end" : "from-start";
        if (wasSelected && index !== -1) return index > prevIndex ? "to-start" : "to-end";
      }
      return null;
    })();
    prevMotionAttributeRef.current = attribute;
    return attribute;
  }, [context.previousValue, context.value, context.dir, getItems, value]);
  return /* @__PURE__ */ jsx(FocusGroup, { asChild: true, children: /* @__PURE__ */ jsx(
    DismissableLayer,
    {
      id: contentId,
      "aria-labelledby": triggerId,
      "data-motion": motionAttribute,
      "data-orientation": context.orientation,
      ...contentProps,
      ref: composedRefs,
      disableOutsidePointerEvents: false,
      onDismiss: () => {
        const rootContentDismissEvent = new Event(ROOT_CONTENT_DISMISS, {
          bubbles: true,
          cancelable: true
        });
        ref.current?.dispatchEvent(rootContentDismissEvent);
      },
      onFocusOutside: composeEventHandlers(props.onFocusOutside, (event) => {
        onContentFocusOutside();
        const target = event.target;
        if (context.rootNavigationMenu?.contains(target)) event.preventDefault();
      }),
      onPointerDownOutside: composeEventHandlers(props.onPointerDownOutside, (event) => {
        const target = event.target;
        const isTrigger = getItems().some((item) => item.ref.current?.contains(target));
        const isRootViewport = context.isRootMenu && context.viewport?.contains(target);
        if (isTrigger || isRootViewport || !context.isRootMenu) event.preventDefault();
      }),
      onKeyDown: composeEventHandlers(props.onKeyDown, (event) => {
        const isMetaKey = event.altKey || event.ctrlKey || event.metaKey;
        const isTabKey = event.key === "Tab" && !isMetaKey;
        if (isTabKey) {
          const candidates = getTabbableCandidates(event.currentTarget);
          const focusedElement = document.activeElement;
          const index = candidates.findIndex((candidate) => candidate === focusedElement);
          const isMovingBackwards = event.shiftKey;
          const nextCandidates = isMovingBackwards ? candidates.slice(0, index).reverse() : candidates.slice(index + 1, candidates.length);
          if (focusFirst(nextCandidates)) {
            event.preventDefault();
          } else {
            focusProxyRef.current?.focus();
          }
        }
      }),
      onEscapeKeyDown: composeEventHandlers(props.onEscapeKeyDown, (_event) => {
        wasEscapeCloseRef.current = true;
      })
    }
  ) });
}, "NavigationMenuContentImpl"));
var VIEWPORT_NAME = "NavigationMenuViewport";
var NavigationMenuViewport = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function NavigationMenuViewport2(props, forwardedRef) {
  const { forceMount, ...viewportProps } = props;
  const context = useNavigationMenuContext(VIEWPORT_NAME, props.__scopeNavigationMenu);
  const open = Boolean(context.value);
  return /* @__PURE__ */ jsx(Presence, { present: forceMount || open, children: /* @__PURE__ */ jsx(NavigationMenuViewportImpl, { ...viewportProps, ref: forwardedRef }) });
}, "NavigationMenuViewport"));
var NavigationMenuViewportImpl = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function NavigationMenuViewportImpl2(props, forwardedRef) {
  const { __scopeNavigationMenu, children, ...viewportImplProps } = props;
  const context = useNavigationMenuContext(VIEWPORT_NAME, __scopeNavigationMenu);
  const composedRefs = useComposedRefs(forwardedRef, context.onViewportChange);
  const viewportContentContext = useViewportContentContext(
    CONTENT_NAME,
    props.__scopeNavigationMenu
  );
  const [size, setSize] = React.useState(null);
  const [content, setContent] = React.useState(null);
  const viewportWidth = size ? size?.width + "px" : void 0;
  const viewportHeight = size ? size?.height + "px" : void 0;
  const open = Boolean(context.value);
  const activeContentValue = open ? context.value : context.previousValue;
  const handleSizeChange = /* @__PURE__ */ __name(() => {
    if (content) setSize({ width: content.offsetWidth, height: content.offsetHeight });
  }, "handleSizeChange");
  useResizeObserver(content, handleSizeChange);
  return /* @__PURE__ */ jsx(
    Primitive.div,
    {
      "data-state": getOpenState(open),
      "data-orientation": context.orientation,
      ...viewportImplProps,
      ref: composedRefs,
      style: {
        // Prevent interaction when animating out
        pointerEvents: !open && context.isRootMenu ? "none" : void 0,
        "--radix-navigation-menu-viewport-width": viewportWidth,
        "--radix-navigation-menu-viewport-height": viewportHeight,
        ...viewportImplProps.style
      },
      onPointerEnter: composeEventHandlers(props.onPointerEnter, context.onContentEnter),
      onPointerLeave: composeEventHandlers(props.onPointerLeave, whenMouse(context.onContentLeave)),
      children: Array.from(viewportContentContext.items).map(([value, { ref, forceMount, ...props2 }]) => {
        const isActive = activeContentValue === value;
        return /* @__PURE__ */ jsx(Presence, { present: forceMount || isActive, children: /* @__PURE__ */ jsx(
          NavigationMenuViewportItem,
          {
            ...props2,
            contentRef: ref,
            isActive,
            onActiveContentChange: setContent
          }
        ) }, value);
      })
    }
  );
}, "NavigationMenuViewportImpl"));
var NavigationMenuViewportItem = /* @__PURE__ */ __name(({
  contentRef,
  isActive,
  onActiveContentChange,
  ...props
}) => {
  const handleContentChange = React.useCallback(
    (node) => {
      if (isActive && node) {
        onActiveContentChange(node);
      }
    },
    [isActive, onActiveContentChange]
  );
  const composedRefs = useComposedRefs(contentRef, handleContentChange);
  return /* @__PURE__ */ jsx(NavigationMenuContentImpl, { ...props, ref: composedRefs });
}, "NavigationMenuViewportItem");
var FOCUS_GROUP_NAME = "FocusGroup";
var FocusGroup = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function FocusGroup2(props, forwardedRef) {
    const { __scopeNavigationMenu, ...groupProps } = props;
    const context = useNavigationMenuContext(FOCUS_GROUP_NAME, __scopeNavigationMenu);
    return /* @__PURE__ */ jsx(FocusGroupCollection.Provider, { scope: __scopeNavigationMenu, children: /* @__PURE__ */ jsx(FocusGroupCollection.Slot, { scope: __scopeNavigationMenu, children: /* @__PURE__ */ jsx(Primitive.div, { dir: context.dir, ...groupProps, ref: forwardedRef }) }) });
  }, "FocusGroup")
);
var ARROW_KEYS = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"];
var FOCUS_GROUP_ITEM_NAME = "FocusGroupItem";
var FocusGroupItem = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function FocusGroupItem2(props, forwardedRef) {
    const { __scopeNavigationMenu, ...groupProps } = props;
    const getItems = useFocusGroupCollection(__scopeNavigationMenu);
    const context = useNavigationMenuContext(FOCUS_GROUP_ITEM_NAME, __scopeNavigationMenu);
    return /* @__PURE__ */ jsx(FocusGroupCollection.ItemSlot, { scope: __scopeNavigationMenu, children: /* @__PURE__ */ jsx(
      Primitive.button,
      {
        ...groupProps,
        ref: forwardedRef,
        onKeyDown: composeEventHandlers(props.onKeyDown, (event) => {
          const isFocusNavigationKey = ["Home", "End", ...ARROW_KEYS].includes(event.key);
          if (isFocusNavigationKey) {
            let candidateNodes = getItems().map((item) => item.ref.current);
            const prevItemKey = context.dir === "rtl" ? "ArrowRight" : "ArrowLeft";
            const prevKeys = [prevItemKey, "ArrowUp", "End"];
            if (prevKeys.includes(event.key)) candidateNodes.reverse();
            if (ARROW_KEYS.includes(event.key)) {
              const currentIndex = candidateNodes.indexOf(event.currentTarget);
              candidateNodes = candidateNodes.slice(currentIndex + 1);
            }
            setTimeout(() => focusFirst(candidateNodes));
            event.preventDefault();
          }
        })
      }
    ) });
  }, "FocusGroupItem")
);
function getTabbableCandidates(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode: /* @__PURE__ */ __name((node) => {
      const isHiddenInput = node.tagName === "INPUT" && node.type === "hidden";
      if (node.disabled || node.hidden || isHiddenInput) return NodeFilter.FILTER_SKIP;
      return node.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }, "acceptNode")
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}
__name(getTabbableCandidates, "getTabbableCandidates");
function focusFirst(candidates) {
  const previouslyFocusedElement = document.activeElement;
  return candidates.some((candidate) => {
    if (candidate === previouslyFocusedElement) return true;
    candidate.focus();
    return document.activeElement !== previouslyFocusedElement;
  });
}
__name(focusFirst, "focusFirst");
function removeFromTabOrder(candidates) {
  candidates.forEach((candidate) => {
    candidate.dataset.tabindex = candidate.getAttribute("tabindex") || "";
    candidate.setAttribute("tabindex", "-1");
  });
  return () => {
    candidates.forEach((candidate) => {
      const prevTabIndex = candidate.dataset.tabindex;
      candidate.setAttribute("tabindex", prevTabIndex);
    });
  };
}
__name(removeFromTabOrder, "removeFromTabOrder");
function useResizeObserver(element, onResize) {
  const handleResize = useCallbackRef(onResize);
  useLayoutEffect(() => {
    let rAF = 0;
    if (element) {
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(rAF);
        rAF = window.requestAnimationFrame(handleResize);
      });
      resizeObserver.observe(element);
      return () => {
        window.cancelAnimationFrame(rAF);
        resizeObserver.unobserve(element);
      };
    }
  }, [element, handleResize]);
}
__name(useResizeObserver, "useResizeObserver");
function getOpenState(open) {
  return open ? "open" : "closed";
}
__name(getOpenState, "getOpenState");
function makeTriggerId(baseId, value) {
  return `${baseId}-trigger-${value}`;
}
__name(makeTriggerId, "makeTriggerId");
function makeContentId(baseId, value) {
  return `${baseId}-content-${value}`;
}
__name(makeContentId, "makeContentId");
function whenMouse(handler) {
  return (event) => event.pointerType === "mouse" ? handler(event) : void 0;
}
__name(whenMouse, "whenMouse");
var Root2 = NavigationMenu;
var Sub = NavigationMenuSub;
var List = NavigationMenuList;
var Item = NavigationMenuItem;
var Trigger = NavigationMenuTrigger;
var Link = NavigationMenuLink;
var Indicator = NavigationMenuIndicator;
var Content = NavigationMenuContent;
var Viewport = NavigationMenuViewport;
export {
  Content,
  Indicator,
  Item,
  Link,
  List,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuSub,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  Root2 as Root,
  Sub,
  Trigger,
  Viewport,
  createNavigationMenuScope
};
//# sourceMappingURL=index.mjs.map
