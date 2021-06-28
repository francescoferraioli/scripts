const exec = require('child_process').exec

exec('fd .trm', (_, result) => {
    const names = result.split("\n").map(path => path.split("/").reverse()[0]).filter(x => x !== '')
    const output = names.reduce((acc, name) => {
        const [recorder, dateTime] = name.split("_")
        const [date, time] = dateTime.split("-")

        const year = +date.substr(0, 4)
        const monthNumber = +date.substr(4, 2) - 1
        const day = +date.substr(6, 2)
        const month = new Date(year, monthNumber, day).toLocaleString('en-us', { month: 'long' })

        if(acc[recorder] === undefined) {
            acc[recorder] = {}
        }

        if(acc[recorder][year] === undefined) {
            acc[recorder][year] = {}
        }

        if(acc[recorder][year][month] === undefined) {
            acc[recorder][year][month] = {}
        }

        if(acc[recorder][year][month][day] === undefined) {
            acc[recorder][year][month][day] = []
        }

        acc[recorder][year][month][day].push(time)
        return acc
    }, {})

    console.log(JSON.stringify(output, undefined, 2))
})