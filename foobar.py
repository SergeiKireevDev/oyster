def foo_bar(n=100):
    """Classic Foo Bar problem — print results for numbers 1..n."""
    for i in range(1, n + 1):
        if i % 15 == 0:
            print("FooBar")
        elif i % 3 == 0:
            print("Foo")
        elif i % 5 == 0:
            print("Bar")
        else:
            print(i)


if __name__ == "__main__":
    foo_bar(100)
