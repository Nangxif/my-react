import { ReactContext } from 'shared/ReactTypes';

let prevContextValue: any = null;

/**
 * 为了应对Provider嵌套的情况，需要有一个栈的结构，用来存储prevContextValue
 */
const prevContextValueStack: any[] = [];

export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
	prevContextValueStack.push(prevContextValue);
	prevContextValue = context._currentValue;
	context._currentValue = newValue;
}

export function popProvider<T>(context: ReactContext<T>) {
	/**
	 *  如果结束Provider标签的话，就得将context的value重置为外层的Provider的value值
	 */
	context._currentValue = prevContextValue;
	prevContextValue = prevContextValueStack.pop();
}
