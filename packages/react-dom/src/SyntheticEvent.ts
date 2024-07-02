import { Container } from 'hostConfig';
import {
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_UserBlockingPriority,
	unstable_runWithPriority
} from 'scheduler';
import { Props } from 'shared/ReactTypes';

export const elementPropsKey = '__props';
const validEventTypeList = ['click'];

type EventCallback = (e: Event) => void;
interface Paths {
	capture: EventCallback[];
	bubble: EventCallback[];
}

interface SyntheticEvent extends Event {
	__stopPropagation: boolean;
}

export interface DOMElement extends Element {
	[elementPropsKey]: Props;
}

export function updateFiberProps(node: DOMElement, props: Props) {
	node[elementPropsKey] = props;
}

export function initEvent(container: Container, eventType: string) {
	if (!validEventTypeList.includes(eventType)) {
		console.warn('当前不支持', eventType, '事件');
	}
	if (__DEV__) {
		console.log('初始化时间', eventType);
	}

	// 在root节点绑定eventType，然后点击某个元素的时候，e这个Event对象指的就是当前点击的对象，可以通过e.target获取到DOMElement
	container.addEventListener(
		eventType,
		(e) => {
			dispatchEvent(container, eventType, e, true);
		},
		true
	);

	container.addEventListener(
		eventType,
		(e) => {
			dispatchEvent(container, eventType, e, false);
		},
		false
	);
}

// 创建合成事件
function createSyntheticEvent(e: Event) {
	const syntheticEvent = e as SyntheticEvent;
	syntheticEvent.__stopPropagation = false;
	const originStopPropagation = e.stopPropagation;
	// 重写原始的stopPropagation
	syntheticEvent.stopPropagation = () => {
		syntheticEvent.__stopPropagation = true;
		if (originStopPropagation) {
			originStopPropagation.call(e);
		}
	};
	return syntheticEvent;
}
function dispatchEvent(
	container: Container,
	eventType: string,
	e: Event,
	isCapture: boolean
) {
	const targetElement = e.target;

	if (targetElement === null) {
		console.warn('事件不存在target', e);
		return;
	}

	// 1. 收集沿途的事件
	const { bubble, capture } = collectPaths(
		targetElement as DOMElement,
		container,
		eventType
	);
	// 2. 构造合成事件
	const se = createSyntheticEvent(e);
	// 3. 遍历capture
	if (isCapture) {
		triggerEventFlow(capture, se);
	}
	// 4. 遍历bubble
	if (!isCapture && !se.__stopPropagation) {
		triggerEventFlow(bubble, se);
	}
}

function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
	for (let i = 0; i < paths.length; i++) {
		const callback = paths[i];
		// 将不同类型的事件赋予不同的优先级，并执行
		unstable_runWithPriority(eventTypetoSchedulerPriority(se.type), () => {
			callback.call(null, se);
		});
		if (se.__stopPropagation) {
			// 如果阻止了冒泡的话，就得阻止事件传播
			break;
		}
	}
}

function getEventCallbackNameFromEventType(
	eventType: string
): string[] | undefined {
	return {
		// 第一项对应的是捕获阶段，第二项对应的是冒泡阶段
		click: ['onClickCapture', 'onClick']
	}[eventType];
}

function collectPaths(
	targetElement: DOMElement,
	container: Container,
	// 收集什么类型的事件
	eventType: string
) {
	const paths: Paths = {
		capture: [],
		bubble: []
	};
	while (targetElement && targetElement !== container) {
		// 收集
		const elementProps = targetElement[elementPropsKey];
		if (elementProps) {
			const callbackNameList = getEventCallbackNameFromEventType(eventType);
			if (callbackNameList) {
				callbackNameList.forEach((callbackName, i) => {
					const eventCallback = elementProps[callbackName];
					if (eventCallback) {
						// 为什么capture需要反向插入
						/**
						 * div onClick onClickCapture
						 *   div onClick onClickCapture
						 *     p targetElement onClick
						 * 比如有这么一个结构
						 * 其中p是targetElement，也就是触发事件的element
						 *
						 * bubble的数组最后会是这样的
						 * [p onClick, div onClick, container onClick]
						 * capture的数组最后会是这样的
						 * [container onClickCapture, div onClickCapture]
						 */
						if (i === 0) {
							// capture
							paths.capture.unshift(eventCallback);
						} else {
							paths.bubble.push(eventCallback);
						}
					}
				});
			}
		}
		targetElement = targetElement.parentNode as DOMElement;
	}
	return paths;
}

function eventTypetoSchedulerPriority(eventType: string) {
	switch (eventType) {
		case 'click':
		case 'keydown':
		case 'keyup':
			return unstable_ImmediatePriority;
		case 'scroll':
			return unstable_UserBlockingPriority;
		default:
			return unstable_NormalPriority;
	}
}
