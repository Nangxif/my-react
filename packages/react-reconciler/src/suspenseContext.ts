// 仿造reactContext，用栈的结构存储Suspense

import { FiberNode } from './fiber';

const suspenseHandlerStack: FiberNode[] = [];

export function getSuspeseHandler() {
	return suspenseHandlerStack[suspenseHandlerStack.length - 1];
}

export function pushSuspeseHandler(handler: FiberNode) {
	suspenseHandlerStack.push(handler);
}

export function popSuspeseHandler() {
	suspenseHandlerStack.pop();
}
