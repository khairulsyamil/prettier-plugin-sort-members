interface A {
	b: string;
	c:  unknown;
	a: string;
}

interface B {
	x: string;
	a(): string;
	z(): string;
	b(): never;
	c: number;
}

interface C {
	z: 0;
	a: string;

	b: string;
	aa: 0;
	m(): unknown;

	c: string;
}

interface D {
	a: string;
	b: string;

	c: 0;

	am(): 0;
	bm(): 0;
}

interface E {
	// comment-on-a
	a: 0;

	// comment-on-c
	c: 0; // tail-comment-c

	// comment-on-d
	d(): 0; // tail-comment-d
	b: 0;	// tail-comment-b

	e(): 0;
	// trailing-comment
}