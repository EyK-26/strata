import React from "react";

const Pagination = ({ page, setPage, lastPage }) => {
	const nextPage = () => {
		if (page < lastPage) {
			setPage(page + 1);
		}
	};

	const prevPage = () => {
		if (page > 1) {
			setPage(page - 1);
		}
	};

	return (
		<div className="Pagination">
			<span>{page}</span>
			<div className="buttons">
				{page !== 1 && <button onClick={prevPage}> Prev </button>}
				{page !== lastPage && <button onClick={nextPage}> Next </button>}
			</div>
		</div>
	);
};

export default Pagination;
