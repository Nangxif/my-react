// 递归中的归阶段

import { FiberNode } from './fiber';
import { NoFlags, Ref, Update, Visibility } from './fiberFlags';
import {
	Container,
	appendInitialChild,
	createInstance,
	createTextInstance
} from 'hostConfig';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText,
	OffScreenComponent,
	SuspenseComponent
} from './workTags';
import { updateFiberProps } from 'react-dom/src/SyntheticEvent';
import { popProvider } from './fiberContext';
import { popSuspeseHandler } from './suspenseContext';

function markUpdate(fiber: FiberNode) {
	fiber.flags |= Update;
}

export const completeWork = (wip: FiberNode) => {
	// 最终返回子fiberNode
	const newProps = wip.pendingProps;
	const current = wip.alternate;
	switch (wip.tag) {
		case HostComponent:
			if (current !== null && wip.stateNode) {
				// update
				// 1. props是否变化
				/**
				 * 比如props上的{onClick: xxx}变成了{onClick: xxxx}
				 */
				// 2. 如果变了，那么这个fiber的flags就应该打一个Update
				/**
				 * 我们可以在fiber的updateQueue记录属性的变化，
				 * 我们可以把它定义成一个数组，这个数组的第N项代表更改的属性名，第N+1项代表更改的属性值
				 * 但是这样实现比较繁琐，我们可以直接用updateFiberProps
				 *
				 */
				updateFiberProps(wip.stateNode, newProps);
				if (current.ref !== wip.ref) {
					markRef(wip);
				}
			} else {
				// 1. 构建DOM
				const instance = createInstance(wip.type, newProps);
				// 2. 将DOM插入到DOM树中
				appendAllChildren(instance, wip);
				// 最后把instance赋值给，wip的stateNode
				wip.stateNode = instance;

				if (wip.ref !== null) {
					markRef(wip);
				}
			}
			/**
			 * 我们在beginWork中标记了Placement这个flags，那么最终等我们的递归阶段都完成了，回到了整个应用的根节点，
			 * 那么我们会得到一棵workInProgress fiberNode树，以及这棵fiberNode树上的某一些节点被标记上了flags，
			 * 那么接下来我们肯定要找到哪些节点被标记上了副作用，并且对他们执行相应的操作，那么这个寻找的过程，如果我们继续对它执行深度优先遍历的话
			 * 那么显然性能不是很高效，那么我们可以利用completeWork向上遍历的这么一个流程，将子fiberNode上的flags冒泡到父fiberNode
			 */
			bubbleProperties(wip);
			return null;
		case HostText:
			if (current !== null && wip.stateNode) {
				// update
				const oldText = current.pendingProps.content;
				const newText = newProps.content;
				if (oldText !== newText) {
					markUpdate(wip);
				}
			} else {
				// 1. 构建DOM
				const instance = createTextInstance(newProps.content);
				// 最后把instance赋值给，wip的stateNode
				wip.stateNode = instance;
			}
			bubbleProperties(wip);
			return null;
		case HostRoot:
		case FunctionComponent:
		case Fragment:
		case OffScreenComponent:
			bubbleProperties(wip);
			return null;
		case ContextProvider:
			const context = wip.type._context;
			popProvider(context);
			bubbleProperties(wip);
			return null;
		case SuspenseComponent:
			popSuspeseHandler();
			const offscreenFiber = wip.child as FiberNode;
			const isHidden = offscreenFiber.pendingProps.mode === 'hidden';
			const currentOffscreenFiber = offscreenFiber.alternate;
			if (currentOffscreenFiber !== null) {
				// update
				const wasHidden = currentOffscreenFiber.pendingProps.mode === 'hidden';
				if (isHidden !== wasHidden) {
					// 说明可见性发生变化了
					offscreenFiber.flags |= Visibility;
					// 这里要冒泡offscreenFiber的副作用，将offscreenFiber的副作用冒泡到SuspenseComponent
					bubbleProperties(offscreenFiber);
				}
			} else if (isHidden) {
				// 如果在mount时，而且是隐藏状态
				offscreenFiber.flags |= Visibility;
				bubbleProperties(offscreenFiber);
			}
			// 最后SuspenseComponent自己也要往上再冒泡
			bubbleProperties(wip);
			return null;
		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况', wip);
			}
			break;
	}
};

function markRef(fiber: FiberNode) {
	fiber.flags |= Ref;
}
// 在parent节点下插入wip这个节点，但是wip本身有可能不是一个DOM节点，所以对于wip，我们还需要一个递归的流程，寻找它里面的HostComponent或者HostText
function appendAllChildren(parent: Container, wip: FiberNode) {
	let node = wip.child;
	while (node !== null) {
		if (node.tag === HostComponent || node.tag === HostText) {
			appendInitialChild(parent, node?.stateNode);
		} else if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}
		// 终止条件就是当node等于wip的时候，因为这个过程是递归的，当归到根节点的时候，就该结束了
		if (node === wip) {
			return;
		}

		// 当子节点全部遍历完之后，就得开始遍历兄弟节点了
		while (node.sibling === null) {
			// 这个时候得开始往上归了，因为兄弟节点也遍历完了
			if (node.return === null || node.return === wip) {
				return;
			}
			node = node?.return;
		}
		node.sibling.return = node?.return;
		node = node?.sibling;
	}
}

// 冒泡副作用的过程
// 因为complete是向上遍历的过程，所以遍历到的每个节点一定是当前最靠上的那个节点，如果我们每次都执行一下bubbleProperties，
// 那么就可以将当前这个节点的子节点以及子节点的兄弟节点中包含的flags冒泡到当前节点的subtreeFlags上
// 这样子我们一直冒泡到根节点，那么如果我们的根节点的subtreeFlags包含了Placement，Update或者ChildDeletion，就代表了当前这棵子树中存在插入，更新或者删除的操作
// 那么我们就可以向下遍历，来找到是哪个fiber包含了副作用，如果某棵树的根节点的subtreeFlags是NoFlags的话，那么就说明当前这棵子树中没有副作用
function bubbleProperties(wip: FiberNode) {
	let subtreeFlags = NoFlags;
	let child = wip.child;

	while (child !== null) {
		// 执行下面两步操作之后，subtreeFlags就会包含当前节点的子节点的flags以及子节点的subtreeFlags
		subtreeFlags |= child.subtreeFlags;
		subtreeFlags |= child.flags;

		child.return = wip;
		child = child.sibling;
	}
	wip.subtreeFlags |= subtreeFlags;
}
