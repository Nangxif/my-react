import {
	unstable_ImmediatePriority as ImmediatePriority,
	unstable_UserBlockingPriority as UserBlockingPriority,
	unstable_NormalPriority as NormalPriority,
	unstable_LowPriority as LowPriority,
	unstable_IdlePriority as IdlePriority,
	unstable_scheduleCallback as scheduleCallback,
	unstable_shouldYield as shouldYield,
	CallbackNode,
	// 取到当前正在调度的回调
	unstable_getFirstCallbackNode as getFirstCallbackNode,
	unstable_cancelCallback as cancelCallback
} from 'scheduler';
/**
 * 并发更新原理
 *
 * 我们当的实现是如何驱动的
 * 1. 交互触发更新
 * 2. 调度阶段微任务调度（ensureRootIsScheduled方法）
 * 3. 调度阶段调度结束，进入render阶段
 * 4. render阶段结束，调度阶段微任务调度（ensureRootIsScheduled方法）
 * 整体是一个大的微任务循环，循环的驱动力是【微任务调度模块】
 */
import './styles.css';
const root = document.querySelector('#root');
// 这里我们在按钮点击事件触发的时候插入一个work，这个work跟Update类似，但是又不是Update
/**
 * 每次交互都会创建一个Work这个Work里面有一个数字，类比react中组件的数量，因为我们render的时候
 * 其实就是要执行每个组件的beginWork和commitWork，那么如果我们把beginWork和commitWork类比成一个工作的话
 * 那么组件有多少，则这个工作就得执行多少次，count就相当于多少次
 */
type Priority =
	| typeof IdlePriority
	| typeof LowPriority
	| typeof NormalPriority
	| typeof UserBlockingPriority
	| typeof ImmediatePriority;
interface Work {
	count: number;
	priority: Priority;
}

// workList就相当于syncQueue
const workList: Work[] = [];

// 保存上一次更新的优先级
let prevPriority: Priority = IdlePriority;
// 当前调度的回调函数
let curCallback: CallbackNode | null;

[LowPriority, NormalPriority, UserBlockingPriority, ImmediatePriority].forEach(
	(priority) => {
		const btn = document.createElement('button');
		root?.appendChild(btn);
		btn.innerText = [
			'',
			'ImmediatePriority',
			'UserBlockingPriority',
			'NormalPriority',
			'LowPriority'
		][priority];
		btn.onclick = () => {
			//1. 交互触发更新
			// 因为整个过程是同步的，因此如果把下面的100改成更大的数字，可能会造成页面卡顿
			// 单个work.count工作量太大，可能造成页面卡顿
			// 因此提出了一种新的概念，并发更新，并发更新的基础是【时间切片】
			workList.unshift({
				count: 100,
				priority: priority as Priority
			});
			//2. 调度阶段微任务调度（ensureRootIsScheduled方法）
			schedule();
		};
	}
);

/**
 *  在微任务调度中，没有优先级的概念，对于Schduler存在5种游戏那集
 * ImmediatePriority
 * // 点击事件优先级
 * UserBlockingPriority
 * NormalPriority
 * LowPriority
 * 空闲时执行，最低优先级
 * IdlePriority
 */
//schedule相当于react中调度的入口ensureRootIsScheduled
function schedule() {
	// 取得上一次的调度节点
	// 获取优先级队列中的第一个（优先级最高的）任务节点。
	const cbNode = getFirstCallbackNode();
	const curWork = workList.sort((w1, w2) => w1.priority - w2.priority)[0];
	// if (curWork) {
	// 	perform(curWork);
	// }
	if (!curWork) {
		// 都已经没有work让你做了，肯定要取消之前的调度
		curCallback = null;
		cbNode && cancelCallback(cbNode);
		return;
	}
	// 策略逻辑
	const { priority: curPriority } = curWork;
	if (curPriority === prevPriority) {
		return;
	}
	// 进入这里的话，肯定是遇到了更高优先级的work
	// 那么接下来就得取消掉之前低优先级的work
	cbNode && cancelCallback(cbNode);
	curCallback = scheduleCallback(curPriority, perform.bind(null, curWork));
}

function perform(work: Work, didTimeout?: boolean): any {
	// 要实现时间分片的话，我们得让下面这个while循环是可中断的
	// while (work.count) {
	// 	work.count--;
	// 	// 这里我们要执行一个我们可以看得到的操作
	// 	insertSpan('0');
	// }

	/**
	 * 那什么情况下我们才能让他可以中断呢
	 * 1. work.priority如果是同步优先级的话，就不能中断了
	 * 2. 饥饿问题，什么是饥饿问题，如果有一个work它一直竞争不过别人，那么就一致得不到执行，那怎么处理这种情况呢
	 * 就是一个work如果一直得不到执行的话，那么它的优先级就会越来越高，直到过期，过期了就该被同步执行了，
	 * 那么如何判断过期了，用didTimeout
	 * 3. 时间切片，也就是说当前如果时间切片的时间已经用尽了，那么就应该把主线程还给浏览器渲染，等下一次有时间了再执行循环
	 * shouldYield会告诉我们时间切片的时间是否用尽
	 */
	// 是否需要同步执行
	const needSync = work.priority === ImmediatePriority || didTimeout;

	while ((needSync || !shouldYield()) && work.count) {
		work.count--;
		insertSpan(work.priority + '');
	}
	// 所以到这一步的时候，有可能不是执行完了，而是上面的while被中断执行了
	prevPriority = work.priority;
	// 这里判断一下是被中断了，还是执行完了，执行完了才走下面的逻辑
	if (!work.count) {
		const workIndex = workList.indexOf(work);
		workList.splice(workIndex, 1);
		// 如果当前work工作完了，那么就重置一下
		prevPriority = IdlePriority;
	}

	// 4. render阶段结束，调度阶段微任务调度（ensureRootIsScheduled方法）
	// schedule();
	/**
	 * 在工作过程仅有一个work的情况下，Scheduler有一个优化路径：如果调度的回调函数的返回值是回调函数，
	 * 则会继续调度返回的函数，也就是说perform的返回值如果是一个函数，那么scheduler会继续调度
	 * 仅有一个work的情况下可以这么写，但是有多个的时候就不行了
	 */
	// return perform.bind(null, work);
	/**
	 *  工作过程中产生相同优先级的work，则不需要开启新的调度
	 * 工作过程中产生更高/更低优先级的work，则只需要把握一个原则，我们每次选出来的都是优先级最高的
	 */
	const prevCallback = curCallback;
	schedule();
	const newCallback = curCallback;
	if (newCallback && prevCallback === newCallback) {
		/**
		 * 这里的意思是，如果我们在上面schedule的过程中，发现curPriority === prevPriority，
		 * 也就是上一次的优先级跟当前优先级是一样的话，就会直接被return掉，然后走const newCallback = curCallback;的逻辑
		 * 此时的prevCallback和newCallback是一样的，表示接下来该调度的还是上次的那个work
		 * 如果新传入的上一次的优先级跟当前优先级不是一样的话，那么就会执行
		 * curCallback = scheduleCallback(curPriority, perform.bind(null, curWork));
		 * 此时prevCallback !== newCallback，那么说明接下来要调度新的work了
		 */

		return perform.bind(null, work);
	}
}

function insertSpan(content: string) {
	const span = document.createElement('span');
	span.innerText = content;
	span.className = `pri-${content}`;
	doSomeBusyWork(10000000);
	root?.appendChild(span);
}

function doSomeBusyWork(len: number) {
	let result = 0;
	while (len--) {
		result += len;
	}
}
