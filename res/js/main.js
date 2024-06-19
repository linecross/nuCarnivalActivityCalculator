var nuCarnivalActivityApp = Vue.createApp({
    data() {
		return{
			editor: {
				activity:{},
				stages: [],
				prizes: [],
				prizeCost: [],
			},
			activityList: [],
			activity: {
				name: '',
				startDate: '', // 開始日期：YYYY-MM-DDTHH:MM:SS
				endDate: '',   // 結束日期：YYYY-MM-DDTHH:MM:SS
				score: 0,                  // 活動總積分
				stageExtras: [],     // 活動關卡加成 ([10,20]=10%和20%，null=無加成，[]=任意輸入加成)
			},
			/* 
			 * 如果加成與計算公式結果有差距，可以在stage中加入extras作更正
			 * 例： {name: '祭典-2', energy: 40, extras: {90:123, 100: 456}}
			 */
			stages: [],
			prizes: [],
			prizeCost:{},
			/* 用戶預設 */
			user: {
				isConsumeGemMode: false,
				targetScore: 0,
				currentScore: 0,
				battleStage: 0,
				battleExtra: 0,
				dailyStageEnergy: 0,
				energyBottles: {
					mini: 0,
					small: 0,
					big: 0,
				},
				isReserveLastDailyStages: false,
				isBuyWeeklyEnergyBottle: false,
				isMonthlyVIPSmall: false,
				isMonthlyVIPBig: false,
			},
			/* 
			* 每日體力水設定：
			* 微型：mini, 小型：small, 大型：big
			*/
			energyGives:{
				daily: ["small"],
				weekly: ["big", "big"],
				buyWeekly: ["small", "small"],
				vipDailyBig: ["big"],
				vipDailySmall: ["small", "small"],
			},
			/* 遊戲預設 */
			game: {
				energyPerHour: 12,
				energyBottle: {
					mini: 10,
					small: 30,
					big: 100,
				},
				gemEnergy: 120,
				gemEnergyUsedGem: 200,
				prizeCost: {	
					'晶靈石': {cost: 1},
					'魔力契約': {cost: 600},
					'魔力契約十卷': {cost: 6000, highlight: 'red'},
					'金幣': {cost: 0.00167},
					'閃耀晶核': {highlight: 'red'},
					'[背景]': {highlight: 'blue'},
					'[背板]': {highlight: 'blue'},
					'[BGM]': {highlight: 'blue'},
					'光屬性鑰匙': {cost: 1600},
					'闇屬性鑰匙': {cost: 1600},
					'火屬性鑰匙': {cost: 1600},
					'水屬性鑰匙': {cost: 1600},
					'木屬性鑰匙': {cost: 1600},
				}
			},
			prizePanel: {
				isCollapse: true,
				reverseOrder: false,
				showIsGetPrize: true,
				showWillGetPrize: true,
				showNotGetPrize: true,
				filterToTargetScore: false,
				filterText: "",
			},
		}
	},
	created: function(){
		this.db = new Dexie('nuActivityCalculatorDB');
		this.db.version(1).stores({
			activity: 'name, file',
			userInput: 'activityName',
			userPref: 'key',
		});

		this.loadPrizeCost();

		fetch("./res/json/activities.json")
		.then(resp => {
			return resp.json();
		})
		.then(json => {
			this.activityList = [];
			if (json.activity != null){
				this.activityList = json.activity;
				var vueObj = this;
				this.loadActivityList().then(e=>{
					vueObj.activity.name = vueObj.activityList[0].name;
					vueObj.loadActivity();
				});
			}
		});
	},
	mounted: async function(){
		this.user.targetScore = this.activity.score;
		await this.loadUserInputs();
		this.$watch(vm => [vm.user, vm.prizePanel], val => {
			this.saveUserInputs();
		}, {
			immediate: true,
			deep: true
		});
	},
	methods: {
		countMonday(startDate, endDate){
			var date = startDate;
			var count = 0;
			while (date < endDate){
				date.setDate(date.getDate() + 1);
				if (date.getDay() === 1){
					count++;
				}
			}
			return count;
		},
		isGetPrize(score){
			if (this.user.currentScore >= score){
				return true;
			}
			return false;
		},
		willGetPrize(score){
			if (this.estimateScore >= score){
				return true;
			}
			return false;
		},
		prizeMark(score){
			if (this.isGetPrize(score)) return 'fa-check';
			if (this.willGetPrize(score)) return 'fa-arrow-rotate-right';
			return "";
		},
		prizeHighlight(prizeName){
			var cp=0;
			const regex = new RegExp(/^\[.+?\]/);
			var item = null;
			var prizePureName = prizeName.substr(prizeName.indexOf(']')+1);
			if (this.prizeCost[prizePureName]){
				item = prizePureName;
			}
			else if (regex.test(prizeName)){
				var type = regex.exec(prizeName)[0];
				if (this.prizeCost[type]){
					item = type;
				}
			}

			
			if (item != null){
				const highlight = this.prizeCost[item].highlight;
			    if (highlight != null && highlight != ''){
					return 'bg-'+highlight;
				}
			}
			
			return "";
		},
		prizeCostNote(){
			var prizeSet = new Set(this.prizes.map(e=>e.item)
				.filter(e=>e.length>0)
				.map(e=>e.substr(e.indexOf("]")+1)));
			var prizeTypeSet = new Set(this.prizes.map(e=>e.item)
				.filter(e=>e.length>0 && e.startsWith("[") && e.indexOf("]"))
				.map(e=>e.substr(0, e.indexOf("]")+1)));
			return Object.keys(this.prizeCost)
				.filter(e=>(prizeSet.has(e) || prizeTypeSet.has(e)) && this.prizeCost[e].cost != null && this.prizeCost[e].cost > 0)
				.map(e=>e+"="+this.prizeCost[e].cost).join(" | ");
		},
		getDateStr(dateStr){
			let date = new Date(dateStr);
			return date.getFullYear() + '-' 
				+ ('0'+(date.getMonth()+1)).slice(-2) + '-'
				+ ('0'+date.getDate()).slice(-2) + ' '
				+ ('0'+date.getHours()).slice(-2) + ':' 
				+ ('0'+date.getMinutes()).slice(-2);
		},
		async loadActivityList(){
			var customActivityList = await this.db.activity.toArray();
			if (customActivityList != null && customActivityList.length > 0){
				var activityMap = new Map();
				this.activityList.forEach(e=>activityMap.set(e.name, e));
				customActivityList.forEach(e=>activityMap.set(e.name, e));
				this.activityList = Array.from(activityMap.values());
			}

			this.activityList = this.activityList.sort((a, b) => {
				if (a.file != b.file) return a.file < b.file;
				return a.name < b.name;
			});
		},
		loadActivity(){
			if (this.activityList.length == 0 || this.activity.name == null || this.activity.name.length == 0){
				return;
			}

			var activity = this.activityList.find(e=>e.name === this.activity.name);
			if (activity == null){
				return;
			}

			if (activity.custom){
				this.activity = JSON.parse(JSON.stringify(activity.data.activity));
				this.stages = JSON.parse(JSON.stringify(activity.data.stages));
				this.prizes = JSON.parse(JSON.stringify(activity.data.prizes));

				this.user.battleStage = 0;
				this.user.targetScore = this.activity.score;
				this.user.currentScore = 0;
				this.user.battleExtra = 0;
				this.loadUserInputs();
			}
			else{
				fetch("./res/json/activity/" + activity.file)
				.then(resp => {
					return resp.json();
				})
				.then(json => {
					if (json.activity != null){
						this.activity = json.activity;
						this.stages = [];
						if (json.stages != null){
							this.stages = json.stages;
						}
						this.prizes = [];
						if (json.prizes != null){
							this.prizes = json.prizes;
						}
						if (json.prizeCost != null){
							this.prizeCost = json.prizeCost;
						}

						this.user.battleStage = 0;
						this.user.targetScore = this.activity.score;
						this.user.currentScore = 0;
						this.user.battleExtra = 0;
						this.loadUserInputs();
					}
					else{
						console.error(activity.name + ' 載入失敗！');
					}
				});
			}
		},
		async addActivityToDB(){
			var date = new Date(this.activity.startDate);
			var dateStr = date.getFullYear()+ ('0'+(date.getMonth()+1)).slice(-2)+('0'+date.getDate()).slice(-2)+'_custom';

			var map = {
				name: this.activity.name,
				file: dateStr,
				custom: true,
				data: {
					activity: this.activity,
					stages: this.stages,
					prizes: this.prizes
				},
			};
			this.db.activity.put(JSON.parse(JSON.stringify(map)));

			var isNewActivity = this.activityList.find(e=>e.name == this.activity.name) == null;
			if (isNewActivity){
				this.user.battleStage = 0;
				this.user.targetScore = this.activity.score;
				this.user.currentScore = 0;
				this.user.battleExtra = 0;
			}
			this.saveUserInputs();
		},
		newActivity(){
			const form = document.querySelector('#activityEditor .needs-validation');
			form.classList.remove('was-validated');

			this.editor = {
				activity:{},
				stages: [{}],
				prizes: [],
				prizeCost: [],
			};
		},
		editActivity(){
			const form = document.querySelector('#activityEditor .needs-validation');
			form.classList.remove('was-validated');

			this.editor.activity = JSON.parse(JSON.stringify(this.activity));
			this.editor.stages = JSON.parse(JSON.stringify(this.stages));
			this.editor.prizes = JSON.parse(JSON.stringify(this.prizes));

			this.editor.prizeCost = [];
			for (var key of Object.keys(this.prizeCost)){
				this.editor.prizeCost.push({
					item: key,
					score: this.prizeCost[key].cost,
					highlight: this.prizeCost[key].highlight
				});
			}
			this.editor.activity.stageExtraVals = '';
			if (this.editor.activity.stageExtras == null){
				this.editor.activity.stageExtraType = 'NA';
			}
			else if (this.editor.activity.stageExtras.length == 0){
				this.editor.activity.stageExtraType = 'FREE';
			}
			else{
				this.editor.activity.stageExtraType = 'FIXED';
				this.editor.activity.stageExtraVals = this.editor.activity.stageExtras.join(',');
			}
		},
		async deleteActivity(){
			if (this.isCustomActivity){
				if (confirm('確定刪除活動 ' + this.activity.name + ' ？')) {
					this.activityList = this.activityList.filter(e=>e.name != this.activity.name);
					await this.db.activity.delete(this.activity.name);
					await this.db.userInput.delete(this.activity.name);
					this.loadActivityList();
					this.activity.name = this.activityList[0].name;
					this.loadActivity();
				}
			}
		},
		async saveActivity(){
			isInputValid = true;
			const form = document.querySelector('#activityEditor .needs-validation');
			if (!form.checkValidity()) {
				isInputValid = false;
			}
			form.classList.add('was-validated');

			if (!isInputValid){
				 return;
			}
			
			this.activity = JSON.parse(JSON.stringify(this.editor.activity));
			this.stages = JSON.parse(JSON.stringify(this.editor.stages));
			this.prizes = JSON.parse(JSON.stringify(this.editor.prizes));
			this.prizes = this.prizes.sort((a, b)=>a.score > b.score);
			this.prizes.forEach(e=>e.score = parseInt(e.score));

			if (!this.activity.name.startsWith("【自訂】")){
				this.activity.name = "【自訂】" + this.activity.name;
			}

			const extraType = this.editor.activity.stageExtraType;
			const extraVals = this.editor.activity.stageExtraVals;
			if (extraType == 'NA') this.activity.stageExtras = null;
			else if (extraType == 'FREE') this.activity.stageExtras = [];
			else this.activity.stageExtras = extraVals.split(',').map(e=>e.trim());
			delete this.activity.stageExtraType;
			delete this.activity.stageExtraVals;
			
			await this.addActivityToDB();
			await this.loadActivityList();
			this.loadActivity();

			const modal = bootstrap.Modal.getInstance('#activityEditor');
			if (modal != null){
				modal.hide();
			}
		},
		async resetPrizeCost(){
			await this.db.userPref.delete("prizeCost");
			await this.loadPrizeCost();
			this.editActivity();
		},
		savePrizeCost(){
			this.prizeCost = {};
			for (var prizeCost of this.editor.prizeCost){
				if (prizeCost.item != null && prizeCost.item.length > 0){
					this.prizeCost[prizeCost.item] = {};
					if (prizeCost.score != null && prizeCost.score != ''){
						this.prizeCost[prizeCost.item]['cost'] = prizeCost.score;
					}
					if (prizeCost.highlight != null && prizeCost.highlight != ''){
						this.prizeCost[prizeCost.item]['highlight'] = prizeCost.highlight;
					}
				}
			}

			map = {
				key: "prizeCost",
				data: this.prizeCost
			}
			this.db.userPref.put(JSON.parse(JSON.stringify(map)));
		},
		async loadPrizeCost(){
			var map = await this.db.userPref.where("key").equals("prizeCost").first();
			if (map != null && map != undefined){
				this.prizeCost = map.data;
			}
			else{
				this.prizeCost = this.game.prizeCost;
			}
		},
		async loadUserInputs(){
			var map = await this.db.userInput.where("activityName").equals(this.activity.name).first();
			if (map != null && map != undefined){
				for (var key of Object.keys(map.user)){
					this.user[key] = map.user[key];
				}
			}

			var userPref = await this.db.userPref.where("key").equals("userPref").first();
			if (userPref != null && userPref != undefined){
				map = userPref.data;
				for (var key of Object.keys(map.user)){
					this.user[key] = map.user[key];
				}
				for (var key of Object.keys(map.prizePanel)){
					this.prizePanel[key] = map.prizePanel[key];
				}
			}
		},
		saveUserInputs(){
			var map = null;
			if (this.user.targetScore > 0 
				&& (this.user.targetScore != this.activity.score || this.user.currentScore != 0 
				|| this.user.battleStage != 0 || this.user.battleExtra != 0)){
				map = {
					activityName: this.activity.name,
					user: {
						targetScore: this.user.targetScore,
						currentScore: this.user.currentScore,
						battleStage: this.user.battleStage,
						battleExtra: this.user.battleExtra,
					}
				};
				this.db.userInput.put(JSON.parse(JSON.stringify(map)));
			}

			map = {
				key: "userPref",
				data:{
					user:{
						dailyStageEnergy: this.user.dailyStageEnergy,
						energyBottles: this.user.energyBottles,
						isReserveLastDailyStages: this.user.isReserveLastDailyStages,
						isBuyWeeklyEnergyBottle: this.user.isBuyWeeklyEnergyBottle,
						isMonthlyVIPSmall: this.user.isMonthlyVIPSmall,
						isMonthlyVIPBig: this.user.isMonthlyVIPBig,
					},
					prizePanel: {
						isCollapse: this.prizePanel.isCollapse,
						reverseOrder: this.prizePanel.reverseOrder,
						showIsGetPrize: this.prizePanel.showIsGetPrize,
						showWillGetPrize: this.prizePanel.showWillGetPrize,
						showNotGetPrize: this.prizePanel.showNotGetPrize,
						filterToTargetScore: this.prizePanel.filterToTargetScore,
					},
				}
			}
			this.db.userPref.put(JSON.parse(JSON.stringify(map)));
		},
		async exportActivityJson(){
			if (this.activity.custom){
				await this.saveActivity();
			}
			var map = {
				activity: this.activity,
				stages: this.stages,
				prizes: this.prizes,
			};
			var json = JSON.stringify(map);
			var blob = new Blob([json], { type: "text/plain;charset=utf-8" });
    		saveAs(blob, this.activity.name + '.json');
		},
		async exportPrizeCostJson(){
			this.savePrizeCost();
			var json = JSON.stringify(this.prizeCost);
			var blob = new Blob([json], { type: "text/plain;charset=utf-8" });
    		saveAs(blob, 'Nu_Prizes.json');
		},
		importActivityJson(event){
			var file = event.target.files[0];
			const reader = new FileReader();
			var vueObj = this;
			reader.onload = async (e) => {
				var str = e.target.result;
				var json = JSON.parse(str);
				if (json.activity != null){
					vueObj.activity = json.activity;
					if (!vueObj.activity.name.startsWith("【自訂】")){
						vueObj.activity.name = "【自訂】" + vueObj.activity.name;
					}
					
					vueObj.stages = [];
					if (json.stages != null){
						vueObj.stages = json.stages;
					}
					vueObj.prizes = [];
					if (json.prizes != null){
						vueObj.prizes = json.prizes;
					}
				}
				await this.addActivityToDB();
				await this.loadActivityList();
				this.loadActivity();
			};
			reader.readAsText(file);
		},
		importPrizeCostJson(event){
			var file = event.target.files[0];
			const reader = new FileReader();
			var vueObj = this;
			reader.onload = async (e) => {
				var str = e.target.result;
				var json = JSON.parse(str);
				if (json != null){
					vueObj.prizeCost = json;
				}
				map = {
					key: "prizeCost",
					data: this.prizeCost
				}
				this.db.userPref.put(JSON.parse(JSON.stringify(map)));
				this.editActivity();
			};
			reader.readAsText(file);
		}
	},
	computed: {
		isCustomActivity(){
			var activity = this.activityList.find(e=>e.name === this.activity.name);
			if (activity != null && activity.custom){
				return true;
			}
			return false;
		},
		isExpired(){
			let lastDate = new Date(this.activity.endDate);
			let now = new Date();
			if (now > lastDate){
				return true;
			}
			return false;
		},
		hoursLeft(){
			if (this.user.isConsumeGemMode){
				return 0;
			}
			let lastDate = new Date(this.activity.endDate);
			let now = new Date();
			if (this.isExpired){
				let startDate = new Date(this.activity.startDate);
				return Math.floor((lastDate-startDate)/1000/60/60);
			}
			return Math.floor((lastDate-now)/1000/60/60);
		},
		dayLeft(){
			if (this.user.isConsumeGemMode){
				return 0;
			}
			return Math.floor(this.hoursLeft / 24);
		},
		dateCountDown(){
			if (this.isExpired){
				return '【已結束】';
			}
			let hourLeft = this.hoursLeft % 24;
			return this.dayLeft + ' 天 ' + hourLeft + ' 小時 ';
		},
		// 每日回體
		sumDailyEnergy(){
			return this.hoursLeft * this.game.energyPerHour;
		},
		// 藥水加持體力
		sumBottleEnergy(){
			if (this.user.isConsumeGemMode){
				return 0;
			}
			let energy = 0;
			energy += this.user.energyBottles.mini * this.game.energyBottle.mini;
			energy += this.user.energyBottles.small * this.game.energyBottle.small;
			energy += this.user.energyBottles.big * this.game.energyBottle.big;

			
			for (var i=0; i<= this.dayLeft; i++){
				for (var x of this.energyGives.daily){
					energy += this.game.energyBottle[x];
				}
				if (this.user.isMonthlyVIPSmall){
					for (var x of this.energyGives.vipDailySmall){
						energy += this.game.energyBottle[x];
					}
				}
				if (this.user.isMonthlyVIPBig){
					for (var x of this.energyGives.vipDailyBig){
						energy += this.game.energyBottle[x];
					}
				}
			}

			let weekLeft = this.countMonday(new Date(), new Date(this.activity.endDate));
			if (this.dayLeft > 0){
				for (var i=0; i < weekLeft; i++){
					for (var x of this.energyGives.weekly){
						energy += this.game.energyBottle[x];
					}
					if (this.user.isBuyWeeklyEnergyBottle){
						for (var x of this.energyGives.buyWeekly){
							energy += this.game.energyBottle[x];
						}
					}
				}
			}

			return energy;
		},
		// 總共體力
		sumEnergy(){
			return this.sumDailyEnergy + this.sumBottleEnergy;
		},
		// 單場戰鬥所需體力
		battleEnergy(){
			return this.stages[this.user.battleStage].energy;
		},
		// 單場戰鬥所得積分
		battleScore(){
			let stage = this.stages[this.user.battleStage];
			if (stage.extras != null && stage.extras[this.user.battleExtra] != null){
				return stage.extras[this.user.battleExtra];
			}
			//return Math.round(stage.score * (1 + this.user.battleExtra/100));
			return Math.ceil(stage.score * (1 + this.user.battleExtra/100));
		},
		// 單場戰鬥CP值
		battleScoreCP(){
			let cp= this.battleScore / this.battleEnergy
			return cp.toFixed(2);
		},
		// 戰鬥總次數
		totalBattleCount(){
			let dailyBattleDays = this.dayLeft;
			if (this.user.isReserveLastDailyStages){
				dailyBattleDays -= 4;
			}
			let totalDailyStageEnergyUsed = this.user.dailyStageEnergy * dailyBattleDays;
			return Math.floor((this.sumEnergy - totalDailyStageEnergyUsed) / this.battleEnergy)
		},
		// 累積戰鬥所得積分
		totalStageScore(){
			return this.totalBattleCount * this.battleScore;
		},
		estimateScore(){
			return Math.round(this.user.currentScore) + this.totalStageScore;
		},
		remainScore(){
			let remain = this.user.targetScore - this.estimateScore;
			if (remain < 0) remain = 0;
			return remain;
		},
		requireEnergy(){
			return Math.ceil(this.remainScore / this.battleScore) * this.battleEnergy;
		},
		remainGem(){
			return Math.ceil(this.requireEnergy / this.game.gemEnergy) * this.game.gemEnergyUsedGem;
		},
		filterPrizesList(){
			var prizeList = [];
			var filterList = this.prizes.slice();

			var filterText = this.prizePanel.filterText;
			filterList = filterList.filter(e=>e.item.includes(filterText));

			for (var prize of filterList){
				if (this.prizePanel.filterToTargetScore && prize.score > this.user.targetScore){
					continue;
				}

				if (this.prizePanel.showIsGetPrize && this.isGetPrize(prize.score)){
					prizeList.push(prize);
				}
				else if (this.prizePanel.showWillGetPrize && !this.isGetPrize(prize.score) && this.willGetPrize(prize.score)){
					prizeList.push(prize);
				}
				else if (this.prizePanel.showNotGetPrize && !this.willGetPrize(prize.score)){
					prizeList.push(prize);
				}
			}

			if (this.prizePanel.reverseOrder){
				prizeList = prizeList.reverse();
			}
			
			return prizeList;
		},
		filterPrizesListTotalQty(){
			var sum = 0;
			this.filterPrizesList.forEach(e=>sum = sum + parseInt(e.qty));
			return sum;
		},
		prizeCP(){
			var cp=0;
			const regex = new RegExp(/^\[.+?\]/);
			var prizeList = this.filterPrizesList;
			for (var prize of prizeList){
				var item = null;
				if (this.prizeCost[prize.item]){
					item = prize.item;
				}
				else if (regex.test(prize.item)){
					var type = regex.exec(prize.item)[0];
					if (this.prizeCost[type]){
						item = type;
					}
				}

				if (item != null && this.prizeCost[item].cost != null){
					cp += prize.qty * this.prizeCost[item].cost;
				}
			}
			return cp;
		}
	},
}).mount('#NuCarnivalActivityApp');