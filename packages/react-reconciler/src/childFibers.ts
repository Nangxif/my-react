import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { Key, Props, ReactElementType } from 'shared/ReactTypes';
import {
	FiberNode,
	createFiberFromElement,
	createFiberFromFragment,
	createWorkInProgress
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { Fragment, HostText } from './workTags';

type ExistingChildren = Map<string | number, FiberNode>;
// shouldTrackEffects是否应该追踪副作用，为false表示不需要追踪副作用，在这种情况下就不用标识flags
// 那他什么时候传true什么时候传false呢？实际上是针对mount流程的，因为在mount流程的时候，才会出现大量的节点插入操作，
// 而在update流程的时候，只存在更新局部的节点

function ChildReconciler(shouldTrackEffects: boolean) {
	function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
		if (!shouldTrackEffects) {
			return;
		}
		const deletions = returnFiber.deletions;
		if (deletions === null) {
			// 代表父fiber下面还没有需要被删除的子fiber
			returnFiber.deletions = [childToDelete];
			returnFiber.flags |= ChildDeletion;
		} else {
			deletions.push(childToDelete);
			// 因为我们在插入第一个需要被删除的节点的时候已经标记了flags，所以在这一步就不需要再标记一次了
		}
	}

	function deleteRemainingChildren(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null
	) {
		if (!shouldTrackEffects) return;
		let childToDelete = currentFirstChild;
		while (childToDelete !== null) {
			deleteChild(returnFiber, childToDelete);
			childToDelete = childToDelete.sibling;
		}
	}
	// 这个方法是用来处理多节点或者单节点变为单节点的情况，比如A1B2C3 -> A1
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		const key = element.key;
		while (currentFiber !== null) {
			// update
			if (currentFiber?.key === key) {
				// key相同
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					if (currentFiber.type === element.type) {
						let props = element.props;
						// if (element.type === REACT_FRAGMENT_TYPE) {
						// 	console.log('333', props);
						// 	props = element.props.children;
						// }
						// type 相同，可以复用
						// 这个props可能包含children属性
						const existing = useFiber(currentFiber, props);
						existing.return = returnFiber;
						// 当前节点可复用，标记剩下的节点删除，既然当前节点是可以复用的，那么被标记为删除的就得从它的第一个兄弟节点开始了currentFiber.sibling
						deleteRemainingChildren(returnFiber, currentFiber.sibling);
						return existing;
					}
					// 如果是key相同，type不同，那么则需要删除所有旧的
					deleteRemainingChildren(returnFiber, currentFiber);
					break;
				} else {
					if (__DEV__) {
						console.warn('还未实现的react类型', element);
						break;
					}
				}
			} else {
				// 如果是key不同，那么久需要删掉当前的这个fiber，然后继续往兄弟节点比较，俺道理，如果更新后是单节点的话，就不存在sibling了，也就会退出while
				deleteChild(returnFiber, currentFiber);
				currentFiber = currentFiber.sibling;
			}
		}
		// 根据element创建fiber
		let fiber;
		if (element.type === REACT_FRAGMENT_TYPE) {
			fiber = createFiberFromFragment(element?.props?.children, key);
		} else {
			fiber = createFiberFromElement(element);
		}
		fiber.return = returnFiber;
		return fiber;
	}

	function reconcileSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
		while (currentFiber !== null) {
			// update
			if (currentFiber.tag === HostText) {
				// 类型没变，可以复用
				const existing = useFiber(currentFiber, { content });
				existing.return = returnFiber;
				deleteRemainingChildren(returnFiber, currentFiber.sibling);
				return existing;
			}
			// 这种情况会走到这里，<div>标签变为文本，这个时候需要删除旧的fiber节点，然后再创建一个新的
			deleteChild(returnFiber, currentFiber);
			// 当前这个节点不能复用的话就继续遍历
			currentFiber = currentFiber.sibling;
		}
		// 都不能复用的话，就根据element创建fiber
		const fiber = new FiberNode(HostText, { content }, null);
		fiber.return = returnFiber;
		return fiber;
	}
	// 插入单一的节点
	function placeSingleChild(fiber: FiberNode) {
		if (shouldTrackEffects && fiber.alternate === null) {
			// 需要副作用，而且当前的workInProgress节点的alternate，也就是对应的current节点为空，说明是首屏加载
			fiber.flags |= Placement;
		}
		return fiber;
	}

	// 处理更新后为多节点的情况
	function reconcileChildrenArray(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null,
		newChild: any[]
	) {
		// 最后一个可复用的fiber在current中的index
		let lastPlacedIndex: number = 0;
		// 创建的最后一个fiber
		let lastNewFiber: FiberNode | null = null;
		// 创建的第一个fiber
		let firstNewFiber: FiberNode | null = null;
		// 整体流程分为四步
		// 1.将current中所有同级fiber保存在Map中
		const existingChildren: ExistingChildren = new Map();
		let current = currentFirstChild;
		while (current) {
			const keyToUse = current.key !== null ? current.key : current.index;
			existingChildren.set(keyToUse, current);
			current = current.sibling;
		}
		for (let i = 0; i < newChild.length; i++) {
			// 2.遍历newChild数组，对于每个遍历到的element，存在两种情况：
			// a：在Map中存在对应对currnt Fiber，且可以复用
			// b：在Map中不存在对应对currnt Fiber，或不可以复用
			const after = newChild[i];
			// 每一个新的fiber都会走这里
			const newFiber = updateFromMap(returnFiber, existingChildren, i, after);

			// 如果更新的之后对值是一个false或者时一个null就会走这段逻辑
			if (newFiber === null) {
				continue;
			}

			// 3.判断是插入还是移动
			newFiber.index = i;
			newFiber.return = returnFiber;

			if (lastNewFiber === null) {
				lastNewFiber = newFiber;
				firstNewFiber = newFiber;
			} else {
				lastNewFiber.sibling = newFiber;
				// lastNewFiber始终指向最后一个fiber
				lastNewFiber = lastNewFiber.sibling;
			}

			if (!shouldTrackEffects) continue;
			const current = newFiber.alternate;

			if (current !== null) {
				const oldIndex = current.index;
				if (oldIndex < lastPlacedIndex) {
					// 移动
					newFiber.flags |= Placement;
					continue;
				} else {
					// 不移动
					lastPlacedIndex = oldIndex;
				}
			} else {
				// mount
				newFiber.flags |= Placement;
			}
		}
		// 4.最后Map中剩下的都标记删除
		existingChildren.forEach((fiber) => {
			deleteChild(returnFiber, fiber);
		});
		return firstNewFiber;
	}

	function updateFromMap(
		returnFiber: FiberNode,
		existingChildren: ExistingChildren,
		index: number,
		element: any
	): FiberNode | null {
		const keyToUse = element.key !== null ? element.key : index;
		const before = existingChildren.get(keyToUse);
		if (typeof element === 'string' || typeof element === 'number') {
			// HostText
			if (before) {
				if (before.tag === HostText) {
					existingChildren.delete(keyToUse);
					return useFiber(before, { content: element + '' });
				}
			}
			return new FiberNode(HostText, { content: element + '' });
		}

		// ReactElement
		if (typeof element === 'object' && element !== null) {
			switch (element.$$typeof) {
				case REACT_ELEMENT_TYPE:
					if (element.type === REACT_FRAGMENT_TYPE) {
						// 如果发现后续的element是一个fragment
						// 这里传进来的element肯定不是一个数组
						return updateFragment(
							returnFiber,
							before,
							element,
							keyToUse,
							existingChildren
						);
					}
					if (before) {
						if (before.type === element.type) {
							existingChildren.delete(keyToUse);
							return useFiber(before, element.props);
						}
					}
					return createFiberFromElement(element);
			}
		}

		/**
		 *
		 * 这里处理的是这种情况
		 *  arr = [<li>3</li>,<li>4</li>]
		 * <ul>
		 * 	<li>1</li>
		 * 	<li>2</li>
		 *  {arr}
		 * </ul>
		 */
		if (Array.isArray(element)) {
			return updateFragment(
				returnFiber,
				before,
				element,
				keyToUse,
				existingChildren
			);
		}
		return null;
	}
	return function reconcileChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: any //ReactElementType
	) {
		// 我们之前说过，在mount阶段的时候，不对副作用进行追踪，但是不追踪的话，我们怎么在首屏渲染的时候给fiber标识Placement呢
		// 其实我们之前已经实现了，在workLoop文件里面，我们在首屏渲染的时候创建了一棵workInProgress树（createWorkInProgress），这是root.current的workInProgress，
		// 也就是hostRootFiber的workInProgress，这意味着在更新流程中，即使是首屏渲染，那么整棵fiber树里面，是有一个节点，它同时存在current以及workInProgress，也就是hostRootFiber这个节点
		// 那么对于首屏渲染，我们挂载的这棵组件树的所有fiber，都会走到mount的逻辑，对于hostRootFiber的话就会走到update的逻辑
		// 那么这一次的update逻辑，那么就会被插入一个Placement的flags，通过这个flags，最终我们就会执行一次dom插入操作
		// 那么这一次dom插入操作就会将整个离屏的DOM树插入到页面中
		// 判断fragment
		/**
		 * 为了提高组件结构的灵活性，需要实现Fragment，具体来说，需要区分以下两种情况
		 */
		/**
		 * 情况1:Fragment包裹其他组件
		 * <>
		 * 	<div/>
		 *  <div/>
		 * </>
		 *
		 * 其实最后等价于
		 * <div/>
		 * <div/>
		 *
		 * 这种情况的jsx转换结果
		 * jsxs(Fragment,{
		 * 	children: [
		 * 		jsx("div", {}),
		 * 		jsx("div", {})
		 *  ]
		 * })
		 */
		// 是否是顶部的没有key的Frgment
		const isUnkeyedTopLevelFragment =
			typeof newChild === 'object' &&
			newChild !== null &&
			newChild.type === REACT_FRAGMENT_TYPE &&
			newChild.key === null;

		if (isUnkeyedTopLevelFragment) {
			// 此处解决的是情况1，将它的children放到当前的newChild，下面就可以走Array.isArray(newChild)的逻辑了
			newChild = newChild?.props?.children;
		}

		if (typeof newChild === 'object' && newChild !== null) {
			// 多节点的情况 ul> li*3
			// fragment的情况2是与其他的组件同级
			/**
			 * <ul>
			 * 	<>
			 * 		<li>1</li>
			 * 		<li>2</li>
			 *  </>
			 * 	<li>3</li>
			 * 	<li>4</li>
			 * </ul>
			 *
			 * 转成jsx为
			 * jsxs('ul',{
			 * 	children: [
			 * 		jsxs(Fragment,{
			 * 			children: [
			 * 				jsx('li', {
			 * 					children: '1'
			 * 				}),
			 * 				jsx('li', {
			 * 					children: '2'
			 * 				}),
			 * 			]
			 * 		}),
			 * 		jsx('li', {
			 * 			children: '3'
			 * 		}),
			 * 		jsx('li', {
			 * 			children: '4'
			 * 		}),
			 * 	]
			 * })
			 * 针对上面这种情况，ul下面已经是一个数组了，那么第二种情况的fragment逻辑应该在reconcileChildrenArray里面处理
			 */
			if (Array.isArray(newChild)) {
				return reconcileChildrenArray(returnFiber, currentFiber, newChild);
			}
			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					return placeSingleChild(
						reconcileSingleElement(returnFiber, currentFiber, newChild)
					);
				default:
					if (__DEV__) {
						console.warn('未实现的reconcile类型', newChild);
					}
					break;
			}
		}

		// HostText
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleChild(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}
		if (currentFiber !== null) {
			deleteRemainingChildren(returnFiber, currentFiber);
		}
		if (__DEV__) {
			console.warn('未实现的reconcile类型', newChild);
		}
		return null;
	};
}

// 复用fiber
function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
	const clone = createWorkInProgress(fiber, pendingProps);
	clone.index = 0;
	clone.sibling = null;
	return clone;
}

function updateFragment(
	returnFiber: FiberNode,
	current: FiberNode | undefined,
	elements: any[],
	key: Key,
	existingChildren: ExistingChildren
) {
	let fiber;
	if (!current || current.tag !== Fragment) {
		// 把数组变为用Fragment包裹起来
		fiber = createFiberFromFragment(elements, key);
	} else {
		existingChildren.delete(key);
		fiber = useFiber(current, elements);
	}
	fiber.return = returnFiber;
	return fiber;
}
export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);
