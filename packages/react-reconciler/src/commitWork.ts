import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
	ChildDeletion,
	Flags,
	LayoutMask,
	MutationMask,
	NoFlags,
	PassiveEffect,
	PassiveMask,
	Placement,
	Ref,
	Update,
	Visibility
} from './fiberFlags';
import {
	Container,
	Instance,
	appendChildToContainer,
	commitUpdate,
	hideInstance,
	hideTextInstance,
	insertChildToContainer,
	removeChild,
	unHideInstance,
	unHideTextInstance
} from 'hostConfig';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText,
	OffScreenComponent
} from './workTags';
import { Effect, FCUpdateQueue } from './fiberHooks';
import { HookHasEffect } from './hostEffectTags';

let nextEffect: FiberNode | null;
export const commitEffects = (
	phase: 'mutation' | 'layout',
	mask: Flags,
	callback: (fiber: FiberNode, root: FiberRootNode) => void
) => {
	return (finishedWork: FiberNode, root: FiberRootNode) => {
		nextEffect = finishedWork;
		while (nextEffect !== null) {
			// 向下遍历
			const child: FiberNode | null = nextEffect.child;

			if ((nextEffect.subtreeFlags & mask) !== NoFlags && child !== null) {
				// 代表了子节点有可能存在MutationMask的操作
				nextEffect = child;
			} else {
				// 表示找底了，或者说我们找到的那个节点不包含subtreeFlags了，如果不包含subtreeFlags的话，那么就可能包含flags
				// 向上遍历DFS
				up: while (nextEffect !== null) {
					callback(nextEffect, root);
					const sibling: FiberNode | null = nextEffect.sibling;
					if (sibling !== null) {
						nextEffect = sibling;
						break up;
					}
					nextEffect = nextEffect.return;
				}
			}
		}
	};
};

const commitMutationEffectsOnFiber = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	const { flags, tag } = finishedWork;

	if ((flags & Placement) !== NoFlags) {
		commitPlacement(finishedWork);
		// 将Placement从副作用中移除
		finishedWork.flags &= ~Placement;
	}

	// flags Update
	if ((flags & Update) !== NoFlags) {
		commitUpdate(finishedWork);
		finishedWork.flags &= ~Update;
	}
	// flags ChildDeletion

	if ((flags & ChildDeletion) !== NoFlags) {
		const deletions = finishedWork.deletions;
		if (deletions !== null) {
			deletions.forEach((childToDelete) => {
				commitDeletion(childToDelete, root);
			});
		}
		finishedWork.flags &= ~ChildDeletion;
	}

	if ((flags & PassiveEffect) !== NoFlags) {
		// 收集回调
		// 这种情况下收集的回调是update，还有一种情况要收集回调，就是delete的时候
		commitPassiveEffect(finishedWork, root, 'update');
		finishedWork.flags &= ~PassiveEffect;
	}

	if ((flags & Ref) !== NoFlags && tag === HostComponent) {
		// 这里要解绑之前的ref，然后在layout阶段绑定新的ref
		// 因此在这里还不能把这个副作用给删除
		safelyDetachRef(finishedWork);
	}

	if ((flags & Visibility) !== NoFlags && tag === OffScreenComponent) {
		const isHidden = finishedWork.pendingProps.mode === 'hidden';
		// 处理Visibility effectTag时需要找到所有子树层Host节点
		// 如果是isHidden为false的话，就得把顶层Host节点的display：none去掉
		hideOrUnhideAllChildren(finishedWork, isHidden);
		finishedWork.flags &= ~Visibility;
	}
};

// 显示或者隐藏所有的子节点
function hideOrUnhideAllChildren(finishedWork: FiberNode, isHidden: boolean) {
	findHostSubtreeRoot(finishedWork, (hostRoot) => {
		const instance = hostRoot.stateNode;
		if (hostRoot.tag === HostComponent) {
			isHidden ? hideInstance(instance) : unHideInstance(instance);
		} else if (hostRoot.tag === HostText) {
			isHidden
				? hideTextInstance(instance)
				: unHideTextInstance(instance, hostRoot.memoizedProps.content);
		}
	});
}

// 找到所有子树的顶层host节点
function findHostSubtreeRoot(
	finishedWork: FiberNode,
	// 找到了就执行下面这个回调函数
	callback: (hostSubtreeRoot: FiberNode) => void
) {
	let node = finishedWork;
	let hostSubtreeRoot = null;
	/**
	 * <Suspense>
	 * 		<div>12</div>
	 * 		<div>
	 * 			<Suspense></Suspense>
	 * 			34
	 * 		</div>
	 * </Suspense>
	 */
	while (true) {
		if (node.tag === HostComponent) {
			if (hostSubtreeRoot === null) {
				hostSubtreeRoot = node;
				callback(node);
			}
		} else if (node.tag === HostText) {
			if (hostSubtreeRoot === null) {
				// hostSubtreeRoot = node;这里就不需要再执行这一步了，因为文本节点没有子孙节点
				callback(node);
			}
		} else if (
			node.tag === OffScreenComponent &&
			node.pendingProps.mode === 'hidden' &&
			node !== finishedWork
		) {
			// 这种情况是OffScreen组件嵌套了OffScreen组件
			// 什么都没有做
			// 也就是说如果我们发现OffScreen嵌套的这种情况的话，就不会往下再遍历了
		} else if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}

		if (node === finishedWork) {
			return;
		}

		while (node.sibling === null) {
			if (node.return === null || node.return === finishedWork) {
				return;
			}

			if (hostSubtreeRoot === node) {
				hostSubtreeRoot = null;
			}
			node = node.return;
		}

		if (hostSubtreeRoot === node) {
			hostSubtreeRoot = null;
		}
		node.sibling!.return = node.return;
		node = node.sibling!;
	}
}

// 解绑ref
function safelyDetachRef(current: FiberNode) {
	const ref = current.ref;
	if (ref !== null) {
		if (typeof ref === 'function') {
			ref(null);
		} else {
			ref.current = null;
		}
	}
}

const commitLayoutEffectsOnFiber = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	const { flags, tag } = finishedWork;

	if ((flags & Ref) !== NoFlags && tag === HostComponent) {
		// 绑定新的ref
		safelyAttachRef(finishedWork);
		finishedWork.flags &= ~Ref;
	}
};

function safelyAttachRef(fiber: FiberNode) {
	const ref = fiber.ref;
	if (ref !== null) {
		const instance = fiber.stateNode;
		if (typeof ref === 'function') {
			ref(instance);
		} else {
			ref.current = instance;
		}
	}
}

export const commitMutationEffects = commitEffects(
	'mutation',
	MutationMask | PassiveEffect,
	commitMutationEffectsOnFiber
);

export const commitLayoutEffects = commitEffects(
	'layout',
	LayoutMask,
	commitLayoutEffectsOnFiber
);
function commitPassiveEffect(
	fiber: FiberNode,
	root: FiberRootNode,
	type: keyof PendingPassiveEffects
) {
	if (
		fiber.tag !== FunctionComponent ||
		(type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
	) {
		return;
	}
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue !== null) {
		if (updateQueue.lastEffect === null && __DEV__) {
			console.error('当FC存在PassiveEffect flag时，不应该不存在effect');
		}
		root.pendingPassiveEffect[type].push(updateQueue.lastEffect as Effect);
	}
}

// 新建一个遍历updateQueue.lastEffect环状链表的一个方法
function commitHookEffectList(
	flags: Flags,
	lastEffect: Effect,
	callback: (effect: Effect) => void
) {
	let effect = lastEffect.next as Effect;
	do {
		if ((effect.tag & flags) === flags) {
			callback(effect);
		}
		effect = effect.next as Effect;
	} while (effect !== lastEffect.next);
}

// 这里对应的是组件卸载
export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			// 对于一个函数组件来说，执行到这里说明他已经卸载了，那么这个组件后续的useEffect肯定不会被触发了
			destroy();
		}

		// 所以这里得移除掉
		effect.tag &= ~HookHasEffect;
	});
}

// 这里对应的是副作用更新的时候，执行的destroy
export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			// 对于一个函数组件来说，执行到这里说明他已经卸载了，那么这个组件后续的useEffect肯定不会被触发了
			destroy();
		}
	});
}

export function commitHookEffectListCreate(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const create = effect.create;
		if (typeof create === 'function') {
			effect.destroy = create();
		}
	});
}

/**
 *
 * 考虑删除Fragment之后，子树的根host节点可能存在多个
 * <div>
 * 	<>
 * 		<p>xxx</p>
 * 		<p>xxx</p>
 * 	</>
 * </div>
 */
const recordHostChildrenToDelete = (
	childrenToDelete: FiberNode[],
	unmountFiber: FiberNode
) => {
	// 1. 找到第一个host root节点
	let lastOne = childrenToDelete[childrenToDelete.length - 1];
	if (!lastOne) {
		// 代表当前没有记录过要删除的host节点
		childrenToDelete.push(unmountFiber);
	} else {
		let node = lastOne.sibling;
		while (node) {
			// 2. 每找到一个host节点，判断一下这个节点是不是1找到的节点的兄弟节点
			if (unmountFiber === node) {
				childrenToDelete.push(unmountFiber);
			}
			node = node.sibling;
		}
	}
};
const commitDeletion = (childToDelete: FiberNode, root: FiberRootNode) => {
	/**
	 * 对于标记ChildDeletion的子树，由于子树中：
	 * 对于FC，需要处理useEffect unmount执行，解绑ref
	 * 对于HostComponent，需要解绑ref
	 * 对于子树的【根HostComponent】，需要移除DOM
	 *
	 * 所以需要实现【遍历ChildDeletion子树】的流程
	 */

	let rootChildrenToDelete: FiberNode[] = [];
	// 递归子树
	commitNestedComponent(childToDelete, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				// 解绑ref
				return;
			case HostText:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				return;
			case FunctionComponent:
				// useEffect unmount处理 解绑ref
				commitPassiveEffect(unmountFiber, root, 'unmount');
				safelyDetachRef(unmountFiber);
				return;
			default:
				if (__DEV__) {
					console.warn('未处理的unmount类型', unmountFiber);
				}
		}
	});
	// 移除rootHostComponent的DOM
	if (rootChildrenToDelete.length) {
		const hostParent = getHostParent(childToDelete);
		if (hostParent !== null) {
			rootChildrenToDelete.forEach((node) => {
				removeChild(node.stateNode, hostParent);
			});
		}
	}
	childToDelete.return = null;
	childToDelete.child = null;
};

const commitNestedComponent = (
	root: FiberNode,
	onCommitUnmount: (fiber: FiberNode) => void
) => {
	let node = root;
	while (true) {
		// 遍历到的每个节点都会调用一下onCommitUnmount这个回调函数
		onCommitUnmount(node);
		if (node.child !== null) {
			// 向下遍历
			node.child.return = node;
			node = node.child;
			continue;
		}
		if (node === root) {
			// 终止条件
			return;
		}
		while (node.sibling === null) {
			if (node.return === null || node.return === root) {
				return;
			}
			// 向上归
			node = node.return;
		}
		node.sibling.return = node.return;
		node = node.sibling;
	}
};
const commitPlacement = (finishedWork: FiberNode) => {
	// finishedWork ~~ DOM

	if (__DEV__) {
		console.warn('执行Placement操作', finishedWork);
	}
	// parent DOM
	const hostParent = getHostParent(finishedWork);

	// host sibling
	// parentNode.insertBefore需要找到【目标兄弟Host节点】，需要考虑两个因素
	/**
	 * 可能并不是目标fiber的直接兄弟节点
	 * 情况1:
	 * <A/><B/>
	 * function B (){
	 * 	return <div/>
	 * }
	 * 情况2:
	 * <A/><div/>
	 * function App () {
	 * 	return <A/>
	 * }
	 * */

	// 不稳定的Host节点不能作为【目标兄弟Host节点】
	const sibling = getHostSibling(finishedWork);

	// finishedWork转成DOM，并且将DOM append到parent DOM里面
	if (hostParent !== null) {
		insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
	}
};

function getHostSibling(fiber: FiberNode) {
	let node: FiberNode = fiber;

	findSibling: while (true) {
		while (node.sibling === null) {
			const parent = node.return;
			if (
				parent === null ||
				parent.tag === HostComponent ||
				parent.tag === HostRoot
			) {
				return null;
			}
			node = parent;
		}
		node.sibling.return = node.return;
		node = node.sibling;
		while (node.tag !== HostText && node.tag !== HostComponent) {
			// 向下遍历
			if ((node.flags & Placement) !== NoFlags) {
				continue findSibling;
			} else {
				node!.child!.return = node;
				node = node.child!;
			}
		}
		if ((node.flags & Placement) === NoFlags) {
			return node.stateNode;
		}
	}
}

// 获取宿主环境的parent节点
function getHostParent(fiber: FiberNode): Container | null {
	let parent = fiber.return;
	while (parent) {
		const parentTag = parent.tag;
		if (parentTag === HostComponent) {
			return parent.stateNode as Container;
		}
		if (parentTag === HostRoot) {
			return (parent.stateNode as FiberRootNode).container;
		}
		parent = parent.return;
	}
	if (__DEV__) {
		console.warn('未找到host parent');
	}
	return null;
}

function insertOrAppendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Container,
	before?: Instance
) {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		if (before) {
			insertChildToContainer(finishedWork.stateNode, hostParent, before);
		} else {
			appendChildToContainer(hostParent, finishedWork.stateNode);
		}
		return;
	}
	// 向下遍历，找到那个tag类型是HostComponent或者HostText的fiber节点
	const child = finishedWork.child;
	if (child !== null) {
		insertOrAppendPlacementNodeIntoContainer(child, hostParent);
		let sibling = child.sibling;
		while (sibling !== null) {
			insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sibling;
		}
	}
}
