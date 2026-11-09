export default [
    {
        rules: {
            "no-unused-vars": [
                "warn",
                {
                    vars: "all",
                    args: "all",
                    argsIgnorePattern: "^_",
                    caughtErrors: "all"
                }
            ],
            "no-unreachable": "error",
            "no-dupe-keys": "error"
        }
    }
];
