import {
    reactive,
    ref,
    pauseTracking,
    resetTracking,
    isRef,
    shallowRef,
    effect,
} from "@vue/reactivity"
import "./symbol-metadata"

type PropertyContext =
    | ClassAccessorDecoratorContext
    | ClassGetterDecoratorContext
    | ClassFieldDecoratorContext

interface Constructor<T> {
    new (...args: any[]): T
}

const ObservationIgnoredSymbol = Symbol()

/**
 * Disables observation tracking of a property.
 *
 * @remarks
 * By default, an object can observe any property of an observable type that
 * is accessible to the observing object. To prevent observation of an
 * accessible property, attach the `ObservationIgnored` decorator to the property.
 *
 * @alpha
 */
export function ObservationIgnored(_target: any, context: PropertyContext) {
    // if (context.static || context.private) {
    //     throw new Error("@ObservationIgnored can only be applied to public instance members.")
    // }

    if (typeof context.name === "symbol") {
        throw new Error("@ObservationIgnored cannot be applied to symbol-named properties.")
    }

    const metadata = (context as any).metadata
    const ignoredProps: string[] = (metadata[ObservationIgnoredSymbol] ??= [])
    ignoredProps.push(context.name)
}

/**
 * A decorator that defines and implements the observer design pattern for the decorated class.
 *
 * @remarks
 * Decorating a class with this decorator signals to other APIs that the class supports
 * observation.
 *
 * @example
 * The following code applies the `Observable` decorator to the type `Car` making it observable:
 *
 * ```ts
 * \@Observable
 * class Car {
 *      name: string = ""
 *      needsRepairs: boolean = false
 *
 *      constructor(name: string, needsRepairs: boolean = false) {
 *          this.name = name
 *          this.needsRepairs = needsRepairs
 *      }
 * }
 * ```
 *
 * @alpha
 */
export function Observable<Target extends Constructor<any>>(
    _target: Target,
    context: ClassDecoratorContext
) {
    if (context.kind !== "class") {
        throw new Error("@Observable must be applied to a class.")
    }

    return class Observed extends _target {
        constructor(...args: any[]) {
            super(...args)

            const prototype = Object.getPrototypeOf(this)
            const metadata = prototype.constructor[(Symbol as any).metadata]
            const ignoredProps: string[] = (metadata[ObservationIgnoredSymbol] ??= [])

            // I was goingn to use this for directly exposing the underlying
            // refs when creating a `Binding`, but I think proxying access to
            // the getter/setter is better for now...
            //
            // I can revisit this when I do some benchmarking
            // this.__refsMap = new Map<string, symbol>()

            const properties = Object.getOwnPropertyNames(this)
            for (const prop of properties) {
                if (ignoredProps.includes(prop)) continue

                let initialValue = Object.getOwnPropertyDescriptor(this, prop)!
                let backingRef = Symbol(`__$$${prop}`)
                // this.__refsMap.set(prop, backingRef)

                Object.defineProperty(this, backingRef, {
                    value:
                        typeof initialValue.value === "object" || initialValue.value === "undefined"
                            ? reactive(initialValue.value)
                            : ref(initialValue.value),
                    writable: true,
                })

                Object.defineProperty(this, prop, {
                    get() {
                        let instance: unknown = this[backingRef]
                        return isRef(instance) ? instance.value : instance
                    },
                    set(v) {
                        let instance: unknown = this[backingRef]
                        if (isRef(instance)) {
                            instance.value = v
                        } else {
                            this[backingRef] = reactive(v)
                        }
                    },
                })

                // TODO: Don't override existing getter/setter pairs
                // TODO: Memoize lone getters
                // TODO: Make sure to explicitly ignore functions
            }
        }
    } as Target
}

/**
 * A class that can read and write a value owned by a source of truth.
 *
 * @remarks
 * Use a binding to create a two-way connection between a property that stores
 * data, and a view that displays and changes the data. A binding connects a
 * property to a source of truth stored elsewhere, instead of storing data
 * directly. For example, a button that toggles between play and pause can
 * create a binding to a property of its parent view using the `bindable`
 * helper function.
 *
 * @alpha
 */
export class Binding<Value> {
    /**
     * A closure that retrieves the binding value. The closure has no
     * parameters, and returns a value.
     */
    get;

    /**
     * A closure that sets the binding value. The closure has the
     * following parameter:
     * - newValue - The new value of the binding value.
     */
    set;

    /**
     * Creates a binding with closures that read and write the binding value.
     *
     * @param get - A closure that retrieves the binding value. The closure has
     * no parameters, and returns a value.
     * @param set - A closure that sets the binding value. The closure has the
     * following parameter:
     *      - newValue - The new value of the binding value.
     */
    constructor(init: { get: () => Value; set: (value: Value) => void }) {
        this.get = init.get
        this.set = init.set
    }
}

export type Bindable<Value extends object> = Value & {
    [Prop in keyof Value & string as `$${Prop}`]: Binding<Value[Prop]>
}

/**
 * A helper function that creates bindings to the mutable properties of observable objects.
 *
 * @remarks
 * Use this helper function to create bindings to mutable properties of a data model object
 * that is decorted by the `@Observable` decorator.
 *
 * @alpha
 */
export function bindable<Value extends object>(observable: Value): Bindable<Value> {
    return Object.assign(
        observable,
        Object.getOwnPropertyNames(observable).map(key => ({
            [`$${key}`]: new Binding({
                get() {
                    return (observable as any)[key]
                },
                set(v) {
                    ;(observable as any)[key] = v
                },
            }),
        }))
    ) as Bindable<Value>
}

/**
 * Execute an arbitrary function in a non-reactive (non-tracking) context. The executed function
 * can, optionally, return a value.
 *
 * @alpha
 */
export function ignoringObservation<T>(nonReactiveReadsFunc: () => T): T {
    pauseTracking()
    const value = nonReactiveReadsFunc()
    resetTracking()
    return value
}

// const computations = new Map<() => any, ComputedRef<any>>()

/**
 * Tracks access to properties.
 *
 * @remarks
 * This method tracks access to any property within the `apply` closure, and
 * informs the caller of value changes made to participating properties by way
 * of the `onChange` closure. For example, the following code tracks changes
 * to the name of cars, but it doesn't track changes to any other property of
 * `Car`:
 *
 *     function render() {
 *         withObservationTracking(
 *              () => {
 *                  for (let car in cars) {
 *                      console.log(car.name)
 *                  }
 *              },
 *              () => {
 *                  console.log("Schedule renderer.")
 *              }
 *          )
 *      }
 *
 * @param apply - A closure that contains properties to track.
 * @param onChange - The closure invoked when the value of a property changes.
 * @returns The value that the `apply` closure returns if it has a return value;
 * otherwise, there is no return value.
 *
 * @alpha
 */
export function withObservationTracking<T>(apply: () => T, onChange?: () => void): void {
    // let cached = computations.get(apply)
    // let applied =
    //     cached ??
    //     computed(() => {
    //         if (onChange) ignoringObservation(onChange)
    //         return apply()
    //     })

    // if (!cached) {
    //     computations.set(apply, applied)
    // }

    // return applied.value

    effect(() => {
        if (onChange) ignoringObservation(onChange)
        return apply()
    })
}

export interface Atom<Value> {
    value: Value
}

@Observable
export class Atom<Value> {
    value: Value

    constructor(initialValue: Value) {
        this.value = initialValue
    }
}

export function atom<Value>(initialValue: Value): Atom<Value> {
    return shallowRef(initialValue)
}
