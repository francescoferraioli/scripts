const exec = require('child_process').exec

exec('fd .trm', (_, result) => {
    const names = result.split("\n").map(path => path.split("/").reverse()[0]).filter(x => x !== '')
    const output = names.reduce((acc, name) => {
        const [recorder, dateTime] = name.split("_")
        const [date, time] = dateTime.split("-")
        if(acc[recorder] === undefined) {
            acc[recorder] = {}
        }

        if(acc[recorder][date] === undefined) {
            acc[recorder][date] = []
        }

        acc[recorder][date].push(time)
        return acc
    }, {})

    console.log(JSON.stringify(output, undefined, 2))
})